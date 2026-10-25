import { canTransition, statusesThatCanBecome } from './booking-status';

describe('booking status state machine', () => {
  it('allows cancelling a confirmed booking', () => {
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
  });

  it('treats CANCELLED as terminal', () => {
    expect(canTransition('CANCELLED', 'CANCELLED')).toBe(false);
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
  });

  it('lists the source statuses for a target status', () => {
    expect(statusesThatCanBecome('CANCELLED')).toEqual(['CONFIRMED']);
    expect(statusesThatCanBecome('CONFIRMED')).toEqual([]);
  });
});
