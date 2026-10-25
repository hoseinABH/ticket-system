// Event contracts published by the bookings module. The producer owns them;
// consumers (e.g. notifications) import from here, never the other way round.
export const BookingEvents = {
  Confirmed: 'booking.confirmed',
  Cancelled: 'booking.cancelled',
} as const;

export interface BookingConfirmedEvent {
  bookingId: string;
  userId: string;
  pnr: string;
  flightNumber: string;
  seatNumbers: string[];
  totalPrice: string;
}

export interface BookingCancelledEvent {
  bookingId: string;
  userId: string;
  pnr: string;
  seatNumbers: string[];
  refundAmount: string;
}
