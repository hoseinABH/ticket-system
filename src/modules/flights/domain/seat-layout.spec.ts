import {
  MAX_CAPACITY,
  SEAT_NUMBER_PATTERN,
  generateSeatNumbers,
} from './seat-layout';

describe('seat layout', () => {
  it('fills rows front to back, six seats per row', () => {
    expect(generateSeatNumbers(8)).toEqual([
      '1A',
      '1B',
      '1C',
      '1D',
      '1E',
      '1F',
      '2A',
      '2B',
    ]);
  });

  it('produces unique seat numbers that match the public pattern', () => {
    const seats = generateSeatNumbers(MAX_CAPACITY);
    expect(new Set(seats).size).toBe(MAX_CAPACITY);
    expect(seats.every((s) => SEAT_NUMBER_PATTERN.test(s))).toBe(true);
    expect(seats.at(-1)).toBe('99F');
  });

  it.each([0, -1, 1.5, MAX_CAPACITY + 1])('rejects capacity %s', (capacity) => {
    expect(() => generateSeatNumbers(capacity)).toThrow(RangeError);
  });

  it.each(['1A', '12F', '99C'])('accepts seat number %s', (seat) => {
    expect(SEAT_NUMBER_PATTERN.test(seat)).toBe(true);
  });

  it.each(['0A', '1G', '100A', '01A', 'A1', '1a'])(
    'rejects seat number %s',
    (seat) => {
      expect(SEAT_NUMBER_PATTERN.test(seat)).toBe(false);
    },
  );
});
