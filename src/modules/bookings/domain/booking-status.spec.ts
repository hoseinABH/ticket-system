import {
  BOOKING_STATUSES,
  canTransition,
  statusesThatCanBecome,
} from './booking-status';

describe('booking status state machine', () => {
  it('settles a pending booking either way', () => {
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'PAYMENT_FAILED')).toBe(true);
  });

  it('only cancels confirmed bookings', () => {
    expect(statusesThatCanBecome('CANCELLED')).toEqual(['CONFIRMED']);
    expect(canTransition('PENDING_PAYMENT', 'CANCELLED')).toBe(false);
  });

  it('confirms or fails only from PENDING_PAYMENT', () => {
    expect(statusesThatCanBecome('CONFIRMED')).toEqual(['PENDING_PAYMENT']);
    expect(statusesThatCanBecome('PAYMENT_FAILED')).toEqual([
      'PENDING_PAYMENT',
    ]);
  });

  it('treats CANCELLED and PAYMENT_FAILED as terminal', () => {
    for (const to of BOOKING_STATUSES) {
      expect(canTransition('CANCELLED', to)).toBe(false);
      expect(canTransition('PAYMENT_FAILED', to)).toBe(false);
    }
  });

  it('never returns to PENDING_PAYMENT', () => {
    expect(statusesThatCanBecome('PENDING_PAYMENT')).toEqual([]);
  });
});
