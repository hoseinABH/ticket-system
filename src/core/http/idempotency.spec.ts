import { BadRequestException } from '@nestjs/common';
import { fingerprint, parseIdempotencyKey } from './idempotency';

describe('idempotency', () => {
  it('accepts a UUID', () => {
    const key = '6f1c2a7e-3b7d-4c2e-9a51-0e8f2b1d4c3a';
    expect(parseIdempotencyKey(key)).toBe(key);
  });

  it.each([undefined, '', 'short', 'has spaces in it', 'x'.repeat(129)])(
    'rejects %j',
    (header) => {
      expect(() => parseIdempotencyKey(header)).toThrow(BadRequestException);
    },
  );

  it('fingerprints equal bodies equally and different bodies differently', () => {
    expect(fingerprint({ quoteToken: 'a' })).toBe(
      fingerprint({ quoteToken: 'a' }),
    );
    expect(fingerprint({ quoteToken: 'a' })).not.toBe(
      fingerprint({ quoteToken: 'b' }),
    );
  });
});
