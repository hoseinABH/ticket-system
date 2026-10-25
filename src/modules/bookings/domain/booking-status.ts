// The booking lifecycle as an explicit state machine. Every status change in
// the app must be a transition listed here; anything else is a bug.
//
//   CONFIRMED ──cancel──▶ CANCELLED (terminal)
export const BOOKING_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  CONFIRMED: ['CANCELLED'],
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
