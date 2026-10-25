import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BookingEvents,
  type BookingCancelledEvent,
  type BookingConfirmedEvent,
} from '../bookings/booking.events';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  @OnEvent(BookingEvents.Confirmed, { async: true })
  async handleBookingConfirmed(event: BookingConfirmedEvent) {
    this.logger.log(
      `[Ticket Issued] PNR: ${event.pnr} | Flight: ${event.flightNumber} | Seats: ${event.seatNumbers.join(', ')} | Total: $${event.totalPrice}`,
    );
  }

  @OnEvent(BookingEvents.Cancelled, { async: true })
  async handleBookingCancelled(event: BookingCancelledEvent) {
    this.logger.log(
      `[Booking Cancelled] PNR: ${event.pnr} | Seats released: ${event.seatNumbers.join(', ')} | Refund: $${event.refundAmount}`,
    );
  }
}
