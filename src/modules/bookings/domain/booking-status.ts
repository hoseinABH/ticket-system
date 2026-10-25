// The booking lifecycle as an explicit state machine. Every status change in
// the app must be a transition listed here; anything else is a bug.
//
//   PENDING_PAYMENT ──paid──────▶ CONFIRMED ──cancel──▶ CANCELLED
//          │
//          └──declined/voided──▶ PAYMENT_FAILED
//
// PENDING_PAYMENT holds the seats while the payment provider is asked.
// CANCELLED and PAYMENT_FAILED are terminal.
export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PAYMENT_FAILED',
  'CANCELLED',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'PAYMENT_FAILED'],
  CONFIRMED: ['CANCELLED'],
  PAYMENT_FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// The statuses a booking may be in for `to` to be a legal next status.
// Used to build the WHERE clause of a conditional UPDATE, so the database
// enforces the transition atomically.
export function statusesThatCanBecome(to: BookingStatus): BookingStatus[] {
  return BOOKING_STATUSES.filter((from) => canTransition(from, to));
}
