import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { DRIZZLE, type DrizzleDB } from '../../core/database/database.module';
import { REDIS } from '../../core/redis/redis.module';
import { flights } from '../../core/database/schema';

export interface FareQuotePayload {
  flightId: string;
  flightNumber: string;
  seatCount: number;
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
        flightNumber: 'IR-711',
        origin: 'THR',
        destination: 'IST',
        departureTime: new Date(Date.now() + 86400000 * 2),
        availableSeats: 50,
        basePrice: '185.00',
      },
      {
        flightNumber: 'TK-875',
        origin: 'THR',
        destination: 'IST',
        departureTime: new Date(Date.now() + 86400000 * 3),
        availableSeats: 12,
        basePrice: '240.50',
      },
    ];

    return this.db
      .insert(flights)
      .values(sampleData)
      .onConflictDoNothing({ target: flights.flightNumber })
      .returning();
  }

  async searchFlights(origin: string, destination: string) {
    const normalizedOrigin = origin.toUpperCase();
    const normalizedDest = destination.toUpperCase();

    return this.db
      .select()
      .from(flights)
      .where(
        and(
          eq(flights.origin, normalizedOrigin),
          eq(flights.destination, normalizedDest),
          gt(flights.availableSeats, 0),
        ),
      );
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

  // Create a 15-minute ephemeral lookup token in Redis locking the calculated price
  async createFareQuote(flightId: string, seatCount: number) {
    const flight = await this.getFlightById(flightId);
    if (flight.availableSeats < seatCount) {
      throw new BadRequestException(
        `Only ${flight.availableSeats} seats remaining`,
      );
    }

    const totalPrice = (Number(flight.basePrice) * seatCount).toFixed(2);
    const quoteToken = `quote_${randomUUID()}`;
    const payload: FareQuotePayload = {
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      seatCount,
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

  // Atomically retrieve and delete the quote token so it cannot be replayed
  async consumeFareQuote(quoteToken: string): Promise<FareQuotePayload> {
    const raw = await this.redis.getdel(`fare_quote:${quoteToken}`);
    if (!raw) {
      throw new BadRequestException(
        'Fare quote token is invalid, expired, or already used',
      );
    }
    return JSON.parse(raw) as FareQuotePayload;
  }

  // Exposed for BookingsModule to call inside an active Postgres transaction
  async reserveSeatsInTransaction(
    tx: DrizzleDB,
    flightId: string,
    seatCount: number,
  ) {
    const [lockedFlight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .for('update');

    if (!lockedFlight || lockedFlight.availableSeats < seatCount) {
      throw new BadRequestException('Requested seats are no longer available');
    }

    await tx
      .update(flights)
      .set({ availableSeats: sql`${flights.availableSeats} - ${seatCount}` })
      .where(eq(flights.id, flightId));
  }

  // Exposed for BookingsModule to return seats inside its cancel transaction.
  // A single atomic UPDATE needs no explicit lock: Postgres row-locks it.
  async releaseSeatsInTransaction(
    tx: DrizzleDB,
    flightId: string,
    seatCount: number,
  ) {
    await tx
      .update(flights)
      .set({ availableSeats: sql`${flights.availableSeats} + ${seatCount}` })
      .where(eq(flights.id, flightId));
  }
}
