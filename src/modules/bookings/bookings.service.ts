import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DRIZZLE, type DrizzleDB } from '../../core/database/database.module';
import { bookings } from '../../core/database/schema';
import { FlightsService } from '../flights/flights.service';

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
    this.eventEmitter.emit('booking.confirmed', {
      bookingId: confirmedBooking.id,
      userId,
      pnr: confirmedBooking.pnr,
      flightNumber: quote.flightNumber,
      seatCount: confirmedBooking.seatCount,
      totalPrice: confirmedBooking.totalLockedPrice,
    });

    return confirmedBooking;
  }

  async getUserBookings(userId: string) {
    return this.db.select().from(bookings).where(eq(bookings.userId, userId));
  }
}
