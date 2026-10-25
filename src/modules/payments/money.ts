// Prices are stored as NUMERIC(10, 2) and arrive as strings like "185.50".
// Payment providers take integer minor units (cents). Converting through a
// float would be wrong: Number("0.29") * 100 === 28.999999999999996.
export function toCents(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) {
    throw new RangeError(`Not a money amount: "${amount}"`);
  }
  const [, units, fraction = ''] = match;
  return Number(units) * 100 + Number(fraction.padEnd(2, '0'));
}
