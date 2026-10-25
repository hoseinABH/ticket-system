import { HttpStatus, type HttpException } from '@nestjs/common';
import { parseIfMatch, toETag } from './etag';

function statusOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return (e as HttpException).getStatus();
  }
  throw new Error('expected an exception');
}

describe('etag', () => {
  it('round-trips a version', () => {
    expect(parseIfMatch(toETag(7))).toBe(7);
  });

  it('requires the header (428)', () => {
    expect(statusOf(() => parseIfMatch(undefined))).toBe(
      HttpStatus.PRECONDITION_REQUIRED,
    );
    expect(statusOf(() => parseIfMatch('  '))).toBe(
      HttpStatus.PRECONDITION_REQUIRED,
    );
  });

  it.each(['3', 'W/"3"', '"abc"', '*', '"3", "4"'])(
    'rejects %s as unmatchable (412)',
    (header) => {
      expect(statusOf(() => parseIfMatch(header))).toBe(
        HttpStatus.PRECONDITION_FAILED,
      );
    },
  );
});
