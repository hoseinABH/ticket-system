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
  PaymentsService,
  type PaymentOutcome,
} from '../payments/payments.service';
import {
  BookingEvents,
  type BookingCancelledEvent,
  type BookingConfirmedEvent,
  type BookingPaymentFailedEvent,
} from './booking.events';
import { canTransition, statusesThatCanBecome } from './domain/booking-status';

// A booking as the API returns it
export type BookingView = typeof bookings.$inferSelect & {
  seatNumbers: string[];
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly flightsService: FlightsService,
    private readonly payments: PaymentsService,
    private readonly outbox: OutboxService,
  ) {}

  // Checkout as a saga: local transaction, remote call, local transaction.
  // The payment call happens with no transaction open: holding row locks
  // while waiting on another company's servers would stall every booking
  // that touches the same seats for as long as they take to answer.
  async checkout(
    userId: string,
    quoteToken: string,
    paymentToken: string,
    idempotencyKey: string,
  ): Promise<{ booking: BookingView; replayed: boolean }> {
    const requestHash = fingerprint({ quoteToken, paymentToken });
    const bookingId = randomUUID(); // up front: the key, seats and charge all use it

    // Saga step 1 (local transaction): claim the key and hold the seats
    const reservation = await this.db.transaction(async (tx) => {
      // A concurrent request holding the same key makes this INSERT wait on
      // the primary key until that request commits (we then replay its
      // booking) or rolls back (we then proceed).
      const [claimed] = await tx
        .insert(idempotencyKeys)
        .values({ userId, key: idempotencyKey, requestHash, bookingId })
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
        return { replayed: true as const, bookingId: existing.bookingId };
      }

      // Any failure below rolls back the key claim too, so a retry with the
      // same key starts fresh
      const quote = await this.flightsService.getFareQuote(quoteToken);
      await this.flightsService.assignSeatsInTransaction(
        tx as unknown as DrizzleDB,
        quote.flightId,
        quote.seatNumbers,
        bookingId,
      );
      await tx.insert(bookings).values({
        id: bookingId,
        userId,
        flightId: quote.flightId,
        pnr: randomBytes(3).toString('hex').toUpperCase(),
        seatCount: quote.seatNumbers.length,
        totalLockedPrice: quote.totalPrice,
        status: 'PENDING_PAYMENT', // seats held, not yet paid for
      });
      return { replayed: false as const, quote };
    });

    // A replay returns the booking's current state, which may have moved on
    // since the original request (e.g. PENDING_PAYMENT -> CONFIRMED)
    if (reservation.replayed) {
      return {
        booking: await this.getBookingView(reservation.bookingId),
        replayed: true,
      };
    }

    // The seats are held, so the quote has done its job. A failed delete
    // must not fail the request: a leftover quote expires on its own and
    // cannot book seats that are now taken.
    await this.flightsService
      .deleteFareQuote(quoteToken)
      .catch((error) =>
        this.logger.warn(`Could not delete used quote: ${String(error)}`),
      );

    // Saga step 2 (remote call): charge the card
    const outcome = await this.payments.charge(
      bookingId,
      reservation.quote.totalPrice,
      paymentToken,
    );

    // Saga step 3 (local transaction): confirm, or compensate. An unknown
    // outcome leaves the booking PENDING_PAYMENT for the reconciler.
    await this.settlePayment(bookingId, outcome);

    return { booking: await this.getBookingView(bookingId), replayed: false };
  }

  // Applies a payment outcome to a booking still in PENDING_PAYMENT. Called
  // by checkout and by the reconciler, possibly at the same time: the
  // conditional UPDATE lets exactly one of them settle the booking, and any
  // later call matches no row and does nothing. Returns whether it settled.
  async settlePayment(
    bookingId: string,
    outcome: PaymentOutcome,
  ): Promise<boolean> {
    if (outcome.status === 'unknown') {
      return false;
    }
    const to = outcome.status === 'succeeded' ? 'CONFIRMED' : 'PAYMENT_FAILED';

    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(bookings)
        .set({
          status: to,
          ...(outcome.status === 'succeeded' && {
            paymentId: outcome.chargeId,
          }),
        })
        .where(
          and(
            eq(bookings.id, bookingId),
            inArray(bookings.status, statusesThatCanBecome(to)),
          ),
        )
        .returning();
      if (!updated) {
        return false; // already settled by someone else
      }

      if (outcome.status === 'succeeded') {
        const flight = await this.flightsService.getFlightById(
          updated.flightId,
        );
        const seatsByBooking =
          await this.flightsService.getSeatNumbersByBookingIds([updated.id]);
        await this.outbox.enqueue(
          tx as unknown as DrizzleDB,
          BookingEvents.Confirmed,
          {
            bookingId: updated.id,
            userId: updated.userId,
            pnr: updated.pnr,
            flightNumber: flight.flightNumber,
            seatNumbers: seatsByBooking.get(updated.id) ?? [],
            totalPrice: updated.totalLockedPrice,
          } satisfies BookingConfirmedEvent,
        );
        return true;
      }

      // Compensation: undo saga step 1 by giving the held seats back
      const releasedSeats = await this.flightsService.releaseSeatsInTransaction(
        tx as unknown as DrizzleDB,
        updated.id,
      );
      await this.outbox.enqueue(
        tx as unknown as DrizzleDB,
        BookingEvents.PaymentFailed,
        {
          bookingId: updated.id,
          userId: updated.userId,
          pnr: updated.pnr,
          seatNumbers: releasedSeats,
          reason: outcome.reason,
        } satisfies BookingPaymentFailedEvent,
      );
      return true;
    });
  }

  async getBookingView(bookingId: string): Promise<BookingView> {
    const [booking] = await this.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    const seatsByBooking = await this.flightsService.getSeatNumbersByBookingIds(
      [bookingId],
    );
    return { ...booking, seatNumbers: seatsByBooking.get(bookingId) ?? [] };
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
