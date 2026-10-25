// Single-aisle cabin: rows numbered from 1, six seats per row (A-F).
export const SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const MAX_ROWS = 99;
export const MAX_CAPACITY = MAX_ROWS * SEAT_LETTERS.length;

export const SEAT_NUMBER_PATTERN = /^[1-9][0-9]?[A-F]$/;

// Fills rows front to back: capacity 8 -> 1A..1F, 2A, 2B
export function generateSeatNumbers(capacity: number): string[] {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    throw new RangeError(
      `capacity must be an integer from 1 to ${MAX_CAPACITY}`,
    );
  }
  return Array.from({ length: capacity }, (_, i) => {
    const row = Math.floor(i / SEAT_LETTERS.length) + 1;
    return `${row}${SEAT_LETTERS[i % SEAT_LETTERS.length]}`;
  });
}
