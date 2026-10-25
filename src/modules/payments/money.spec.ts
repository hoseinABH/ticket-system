import { toCents } from './money';

describe('toCents', () => {
  it.each([
    ['185.00', 18500],
    ['240.5', 24050],
    ['0.29', 29], // via float this would be 28.999999999999996
    ['1.01', 101],
    ['7', 700],
  ])('converts %s to %d cents', (amount, cents) => {
    expect(toCents(amount)).toBe(cents);
  });

  it.each(['', '-1.00', '1.234', '1,00', 'abc'])('rejects %j', (amount) => {
    expect(() => toCents(amount)).toThrow(RangeError);
  });
});
