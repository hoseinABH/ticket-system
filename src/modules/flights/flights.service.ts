import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  sql,
} from 'drizzle-orm';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { DRIZZLE, type DrizzleDB } from '../../core/database/database.module';
import { REDIS } from '../../core/redis/redis.module';
import { flights, seats } from '../../core/database/schema';
import { generateSeatNumbers } from './domain/seat-layout';

export interface FareQuotePayload {
  flightId: string;
  flightNumber: string;
  seatNumbers: string[];
  totalPrice: string;
  expiresAt: number;
}

@Injectable()
export class FlightsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // Helper endpoint to populate initial test flights
  async seedSampleFlights() {
    const sampleData = [
      {
        capacity: 50,
        flight: {
          flightNumber: 'IR-711',
          origin: 'THR',
          destination: 'IST',
          departureTime: new Date(Date.now() + 86400000 * 2),
          basePrice: '185.00',
        },
      },
      {
        capacity: 12,
        flight: {
          flightNumber: 'TK-875',
          origin: 'THR',
          destination: 'IST',
          departureTime: new Date(Date.now() + 86400000 * 3),
          basePrice: '240.50',
        },
      },
    ];

    return this.db.transaction(async (tx) => {
      const created = await tx
        .insert(flights)
        .values(sampleData.map((s) => s.flight))
        .onConflictDoNothing({ target: flights.flightNumber })
        .returning();

      // Seats only for flights this call actually inserted
      const seatRows = created.flatMap((flight) => {
        const { capacity } = sampleData.find(
          (s) => s.flight.flightNumber === flight.flightNumber,
        )!;
        return generateSeatNumbers(capacity).map((seatNumber) => ({
          flightId: flight.id,
          seatNumber,
        }));
      });
      if (seatRows.length > 0) {
        await tx.insert(seats).values(seatRows);
      }
      return created;
    });
  }

  async searchFlights(origin: string, destination: string) {
    return this.searchFlightsQuery(origin, destination);
  }

  // availableSeats is computed from the seat rows, so the API response keeps
  // the same shape it had when it was a stored counter.
  //
  // Shaped as "for each matching flight, count its free seats" (LATERAL)
  // rather than JOIN + GROUP BY: the join form made Postgres scan every seat
  // of every flight, while this form does one index-only scan of
  // seats_free_by_flight_idx per flight (~30 ms -> ~2 ms on 600k seats).
  // Public so the query-plan lab can EXPLAIN the exact query the app runs.
  searchFlightsQuery(origin: string, destination: string) {
    const free = this.db
      .select({
        availableSeats: sql<number>`count(*)::int`.as('available_seats'),
      })
      .from(seats)
      .where(and(eq(seats.flightId, flights.id), isNull(seats.bookingId)))
      .as('free');

    return this.db
      .select({
        ...getTableColumns(flights),
        availableSeats: free.availableSeats,
      })
      .from(flights)
      .crossJoinLateral(free)
      .where(
        and(
          eq(flights.origin, origin.toUpperCase()),
          eq(flights.destination, destination.toUpperCase()),
          gt(flights.departureTime, sql`now()`),
          gt(free.availableSeats, 0),
        ),
      )
      .orderBy(asc(flights.departureTime));
  }

  async getFlightById(flightId: string) {
    const [flight] = await this.db
      .select()
      .from(flights)
      .where(eq(flights.id, flightId));
    if (!flight) {
      throw new NotFoundException('Flight not found');
    }
    return flight;
  }

  // Optimistic concurrency: the write succeeds only if the row is still at
  // the version the client read. No lock is held between the client's GET
  // and this PATCH, which may be minutes apart; a conflicting edit in
  // between simply makes this UPDATE match zero rows.
  async updateFlight(
    flightId: string,
    expectedVersion: number,
    changes: { departureTime?: string; basePrice?: string },
  ) {
    if (
      changes.departureTime === undefined &&
      changes.basePrice === undefined
    ) {
      throw new BadRequestException('Provide departureTime and/or basePrice');
    }
    if (changes.basePrice !== undefined && Number(changes.basePrice) <= 0) {
      throw new BadRequestException('basePrice must be positive');
    }

    const [updated] = await this.db
      .update(flights)
      .set({
        ...(changes.departureTime !== undefined && {
          departureTime: new Date(changes.departureTime),
        }),
        ...(changes.basePrice !== undefined && {
          basePrice: changes.basePrice,
        }),
        version: sql`${flights.version} + 1`,
      })
      .where(
        and(eq(flights.id, flightId), eq(flights.version, expectedVersion)),
      )
      .returning();

    if (!updated) {
      // Zero rows: either the flight is gone or someone edited it first
      const current = await this.getFlightById(flightId);
      throw new PreconditionFailedException(
        `Flight was modified by someone else (now at version ${current.version}); reload and retry`,
      );
    }
    return updated;
  }

  // Seat map for clients. Exposes only whether a seat is free, never which
  // booking holds it.
  async getSeatMap(flightId: string) {
    await this.getFlightById(flightId);
    const rows = await this.db
      .select({ seatNumber: seats.seatNumber, bookingId: seats.bookingId })
      .from(seats)
      .where(eq(seats.flightId, flightId))
      .orderBy(sql`length(${seats.seatNumber})`, asc(seats.seatNumber));
    return rows.map(({ seatNumber, bookingId }) => ({
      seatNumber,
      available: bookingId === null,
    }));
  }

  // Create a 15-minute ephemeral lookup token in Redis locking the calculated price
  async createFareQuote(flightId: string, seatNumbers: string[]) {
    const flight = await this.getFlightById(flightId);

    // A friendly early check only: the seats can still be taken by someone
    // else before checkout, which re-checks them under a lock
    const found = await this.db
      .select({ seatNumber: seats.seatNumber, bookingId: seats.bookingId })
      .from(seats)
      .where(
        and(
          eq(seats.flightId, flightId),
          inArray(seats.seatNumber, seatNumbers),
        ),
      );
    const unknown = seatNumbers.filter(
      (n) => !found.some((s) => s.seatNumber === n),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Seats do not exist on this flight: ${unknown.join(', ')}`,
      );
    }
    const taken = found.filter((s) => s.bookingId !== null);
    if (taken.length > 0) {
      throw new ConflictException(
        `Seats already taken: ${taken.map((s) => s.seatNumber).join(', ')}`,
      );
    }

    const totalPrice = (Number(flight.basePrice) * seatNumbers.length).toFixed(
      2,
    );
    const quoteToken = `quote_${randomUUID()}`;
    const payload: FareQuotePayload = {
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      seatNumbers,
      totalPrice,
      expiresAt: Date.now() + 15 * 60 * 1000,
    };

    await this.redis.set(
      `fare_quote:${quoteToken}`,
      JSON.stringify(payload),
      'EX',
      900,
    );
    return { quoteToken, quote: payload };
  }

  // Read, not consumed: the quote is deleted only after the booking commits,
  // so a checkout that fails part-way leaves the quote usable for a retry
  async getFareQuote(quoteToken: string): Promise<FareQuotePayload> {
    const raw = await this.redis.get(`fare_quote:${quoteToken}`);
    if (!raw) {
      throw new BadRequestException(
        'Fare quote token is invalid, expired, or already used',
      );
    }
    return JSON.parse(raw) as FareQuotePayload;
  }

  // Called after a successful checkout. Single use is a convenience here,
  // not a safety net: a second checkout of the same quote would fail anyway,
  // because its seats are already assigned.
  async deleteFareQuote(quoteToken: string) {
    await this.redis.del(`fare_quote:${quoteToken}`);
  }

  // Exposed for BookingsModule to call inside an active Postgres transaction.
  // Locks only the requested seats, so bookings for other seats on the same
  // flight proceed in parallel instead of queueing on the flight row.
  async assignSeatsInTransaction(
    tx: DrizzleDB,
    flightId: string,
    seatNumbers: string[],
    bookingId: string,
  ) {
    // ORDER BY makes every transaction acquire row locks in the same order.
    // Without a global order, two bookings wanting {1A, 1B} and {1B, 1A}
    // could each lock one seat and wait forever for the other (deadlock).
    const locked = await tx
      .select()
      .from(seats)
      .where(
        and(
          eq(seats.flightId, flightId),
          inArray(seats.seatNumber, seatNumbers),
        ),
      )
      .orderBy(asc(seats.seatNumber))
      .for('update');

    const taken = locked.filter((s) => s.bookingId !== null);
    if (locked.length !== seatNumbers.length || taken.length > 0) {
      throw new ConflictException(
        'One or more requested seats are no longer available',
      );
    }

    await tx
      .update(seats)
      .set({ bookingId })
      .where(
        inArray(
          seats.id,
          locked.map((s) => s.id),
        ),
      );
  }

  // Exposed for BookingsModule to free seats inside its cancel transaction.
  // Returns the released seat numbers.
  async releaseSeatsInTransaction(tx: DrizzleDB, bookingId: string) {
    const released = await tx
      .update(seats)
      .set({ bookingId: null })
      .where(eq(seats.bookingId, bookingId))
      .returning({ seatNumber: seats.seatNumber });
    return released.map((s) => s.seatNumber);
  }

  // One query for any number of bookings, instead of one query per booking
  // (the N+1 problem)
  async getSeatNumbersByBookingIds(
    bookingIds: string[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (bookingIds.length === 0) {
      return result;
    }
    const rows = await this.db
      .select({ bookingId: seats.bookingId, seatNumber: seats.seatNumber })
      .from(seats)
      .where(inArray(seats.bookingId, bookingIds))
      .orderBy(asc(seats.seatNumber));
    for (const { bookingId, seatNumber } of rows) {
      result.set(bookingId!, [...(result.get(bookingId!) ?? []), seatNumber]);
    }
    return result;
  }
}
