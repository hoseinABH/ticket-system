import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'crypto';
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

    // 2. Run seat assignment and booking insertion in one ACID transaction.
    //    The ID is generated up front so the seats can point at the booking.
    const bookingId = randomUUID();
    const confirmedBooking = await this.db.transaction(async (tx) => {
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

      return { ...created, seatNumbers: quote.seatNumbers };
    });

    // 3. Emit asynchronous domain event for NotificationsModule
    this.eventEmitter.emit(BookingEvents.Confirmed, {
      bookingId: confirmedBooking.id,
      userId,
      pnr: confirmedBooking.pnr,
      flightNumber: quote.flightNumber,
      seatNumbers: confirmedBooking.seatNumbers,
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

      const releasedSeats = await this.flightsService.releaseSeatsInTransaction(
        tx as unknown as DrizzleDB,
        updated.id,
      );
      return { ...updated, seatNumbers: releasedSeats };
    });

    this.eventEmitter.emit(BookingEvents.Cancelled, {
      bookingId: cancelled.id,
      userId,
      pnr: cancelled.pnr,
      seatNumbers: cancelled.seatNumbers,
      refundAmount: cancelled.totalLockedPrice,
    } satisfies BookingCancelledEvent);

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
