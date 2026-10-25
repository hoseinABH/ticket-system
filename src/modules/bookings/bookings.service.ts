import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DRIZZLE, type DrizzleDB } from '../../core/database/database.module';
import { bookings } from '../../core/database/schema';
import { FlightsService } from '../flights/flights.service';
import {
  BookingEvents,
  type BookingCancelledEvent,
  type BookingConfirmedEvent,
} from './booking.events';
import { canTransition, statusesThatCanBecome } from './domain/booking-status';

@Injectable()
export class BookingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly flightsService: FlightsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async checkout(userId: string, quoteToken: string) {
    // 1. Atomically pop the ephemeral quote token from Redis
    const quote = await this.flightsService.consumeFareQuote(quoteToken);

    // 2. Run seat reservation and booking insertion in one ACID transaction
    const confirmedBooking = await this.db.transaction(async (tx) => {
      await this.flightsService.reserveSeatsInTransaction(
        tx as unknown as DrizzleDB,
        quote.flightId,
        quote.seatCount,
      );

      const pnr = randomBytes(3).toString('hex').toUpperCase();

      const [created] = await tx
        .insert(bookings)
        .values({
          userId,
          flightId: quote.flightId,
          pnr,
          seatCount: quote.seatCount,
          totalLockedPrice: quote.totalPrice,
          status: 'CONFIRMED',
        })
        .returning();

      return created;
    });

    // 3. Emit asynchronous domain event for NotificationsModule
    this.eventEmitter.emit(BookingEvents.Confirmed, {
      bookingId: confirmedBooking.id,
      userId,
      pnr: confirmedBooking.pnr,
      flightNumber: quote.flightNumber,
      seatCount: confirmedBooking.seatCount,
      totalPrice: confirmedBooking.totalLockedPrice,
    } satisfies BookingConfirmedEvent);

    return confirmedBooking;
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

      await this.flightsService.releaseSeatsInTransaction(
        tx as unknown as DrizzleDB,
        updated.flightId,
        updated.seatCount,
      );
      return updated;
    });

    this.eventEmitter.emit(BookingEvents.Cancelled, {
      bookingId: cancelled.id,
      userId,
      pnr: cancelled.pnr,
      seatCount: cancelled.seatCount,
      refundAmount: cancelled.totalLockedPrice,
    } satisfies BookingCancelledEvent);

    return cancelled;
  }

  async getUserBookings(userId: string) {
    return this.db.select().from(bookings).where(eq(bookings.userId, userId));
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
