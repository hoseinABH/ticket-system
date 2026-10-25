import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'crypto';
import { DRIZZLE, type DrizzleDB } from '../../core/database/database.module';
import { bookings, idempotencyKeys } from '../../core/database/schema';
import { fingerprint } from '../../core/http/idempotency';
import { OutboxService } from '../../core/outbox/outbox.service';
import { FlightsService } from '../flights/flights.service';
import {
  BookingEvents,
  type BookingCancelledEvent,
  type BookingConfirmedEvent,
} from './booking.events';
import { canTransition, statusesThatCanBecome } from './domain/booking-status';

// The booking as returned by checkout (and replayed from storage), in its
// JSON form: dates are ISO strings
export interface CheckoutResponse {
  id: string;
  userId: string;
  flightId: string;
  pnr: string;
  seatCount: number;
  totalLockedPrice: string;
  status: string;
  createdAt: string;
  cancelledAt: string | null;
  seatNumbers: string[];
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly flightsService: FlightsService,
    private readonly outbox: OutboxService,
  ) {}

  // Idempotent checkout: the first request with a given key books; any
  // retry with the same key gets the original response back instead.
  async checkout(
    userId: string,
    quoteToken: string,
    idempotencyKey: string,
  ): Promise<{ booking: CheckoutResponse; replayed: boolean }> {
    const requestHash = fingerprint({ quoteToken });

    const result = await this.db.transaction(async (tx) => {
      // 1. Claim the key. A concurrent request holding the same key makes
      //    this INSERT wait on the primary key until that request commits
      //    (we then replay its result) or rolls back (we then proceed).
      const [claimed] = await tx
        .insert(idempotencyKeys)
        .values({ userId, key: idempotencyKey, requestHash })
        .onConflictDoNothing()
        .returning();

      if (!claimed) {
        const [existing] = await tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.userId, userId),
              eq(idempotencyKeys.key, idempotencyKey),
            ),
          );
        if (existing.requestHash !== requestHash) {
          throw new UnprocessableEntityException(
            'This Idempotency-Key was already used for a different request',
          );
        }
        return {
          booking: existing.response as CheckoutResponse,
          replayed: true as const,
        };
      }

      // 2. First time this key is seen: book. Any failure below rolls back
      //    the key claim too, so a retry with the same key starts fresh.
      const quote = await this.flightsService.getFareQuote(quoteToken);
      const bookingId = randomUUID(); // up front, so seats can point at it
      await this.flightsService.assignSeatsInTransaction(
        tx as unknown as DrizzleDB,
        quote.flightId,
        quote.seatNumbers,
        bookingId,
      );

      const pnr = randomBytes(3).toString('hex').toUpperCase();
      const [created] = await tx
        .insert(bookings)
        .values({
          id: bookingId,
          userId,
          flightId: quote.flightId,
          pnr,
          seatCount: quote.seatNumbers.length,
          totalLockedPrice: quote.totalPrice,
          status: 'CONFIRMED',
        })
        .returning();

      // 3. Record the response in the same transaction as the booking
      // Stored as JSON, exactly as it will be serialized to the client, so
      // a replay is byte-for-byte the response the first request returned
      const response = JSON.parse(
        JSON.stringify({ ...created, seatNumbers: quote.seatNumbers }),
      ) as CheckoutResponse;
      await tx
        .update(idempotencyKeys)
        .set({ response })
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, idempotencyKey),
          ),
        );

      // 4. The event commits with the booking, or not at all
      await this.outbox.enqueue(
        tx as unknown as DrizzleDB,
        BookingEvents.Confirmed,
        {
          bookingId: response.id,
          userId,
          pnr: response.pnr,
          flightNumber: quote.flightNumber,
          seatNumbers: response.seatNumbers,
          totalPrice: response.totalLockedPrice,
        } satisfies BookingConfirmedEvent,
      );

      return { booking: response, replayed: false as const };
    });

    if (result.replayed) {
      return { booking: result.booking, replayed: true };
    }

    // 5. Clean-up after commit, only for the original request. The booking
    //    is already committed, so a failure here must not turn the response
    //    into an error: a leftover quote expires on its own and cannot book
    //    seats that are now taken.
    await this.flightsService
      .deleteFareQuote(quoteToken)
      .catch((error) =>
        this.logger.warn(`Could not delete used quote: ${String(error)}`),
      );
    return { booking: result.booking, replayed: false };
  }

  async cancel(userId: string, bookingId: string) {
    // 1. Friendly pre-checks. These read outside the transaction, so they can
    //    be stale by the time we write; they exist for clear error messages.
    const booking = await this.getOwnedBooking(userId, bookingId);
    if (!canTransition(booking.status, 'CANCELLED')) {
      throw new ConflictException(`Booking is already ${booking.status}`);
    }

    const flight = await this.flightsService.getFlightById(booking.flightId);
    if (flight.departureTime <= new Date()) {
      throw new ConflictException('Cannot cancel a booking after departure');
    }

    // 2. The real guard: a conditional UPDATE that only matches a row still in
    //    a status allowed to become CANCELLED. Concurrent cancels queue on the
    //    row lock; once the winner commits, the others re-check the WHERE
    //    clause, match nothing, and seats are released exactly once.
    const cancelled = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(bookings)
        .set({ status: 'CANCELLED', cancelledAt: new Date() })
        .where(
          and(
            eq(bookings.id, bookingId),
            eq(bookings.userId, userId),
            inArray(bookings.status, statusesThatCanBecome('CANCELLED')),
          ),
        )
        .returning();

      if (!updated) {
        throw new ConflictException('Booking was already cancelled');
      }

      const releasedSeats = await this.flightsService.releaseSeatsInTransaction(
        tx as unknown as DrizzleDB,
        updated.id,
      );

      await this.outbox.enqueue(
        tx as unknown as DrizzleDB,
        BookingEvents.Cancelled,
        {
          bookingId: updated.id,
          userId,
          pnr: updated.pnr,
          seatNumbers: releasedSeats,
          refundAmount: updated.totalLockedPrice,
        } satisfies BookingCancelledEvent,
      );
      return { ...updated, seatNumbers: releasedSeats };
    });

    return cancelled;
  }

  async getUserBookings(userId: string) {
    const userBookings = await this.db
      .select()
      .from(bookings)
      .where(eq(bookings.userId, userId))
      .orderBy(desc(bookings.createdAt));
    const seatsByBooking = await this.flightsService.getSeatNumbersByBookingIds(
      userBookings.map((b) => b.id),
    );
    // Cancelled bookings have released their seats, so they list none
    return userBookings.map((b) => ({
      ...b,
      seatNumbers: seatsByBooking.get(b.id) ?? [],
    }));
  }

  // Someone else's booking is reported as "not found", not "forbidden",
  // so the API never confirms that a given booking ID exists
  private async getOwnedBooking(userId: string, bookingId: string) {
    const [booking] = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)));
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }
}
