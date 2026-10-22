import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

export interface BookingConfirmedEvent {
  bookingId: string;
  userId: string;
  pnr: string;
  flightNumber: string;
  seatCount: number;
  totalPrice: string;
}

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  @OnEvent('booking.confirmed', { async: true })
  async handleBookingConfirmed(event: BookingConfirmedEvent) {
    this.logger.log(
      `[Ticket Issued] PNR: ${event.pnr} | Flight: ${event.flightNumber} | Seats: ${event.seatCount} | Total: $${event.totalPrice}`,
    );
  }
}
