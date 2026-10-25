import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

// Clients should send a fresh UUID per intent (e.g. per "Buy" click) and
// reuse it for every retry of that same intent
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function parseIdempotencyKey(header: string | undefined): string {
  if (header === undefined || header === '') {
    throw new BadRequestException(
      'Idempotency-Key header is required: send a new UUID per purchase and reuse it on retries',
    );
  }
  if (!KEY_PATTERN.test(header)) {
    throw new BadRequestException(
      'Idempotency-Key must be 8-128 characters of A-Z, a-z, 0-9, "-" or "_"',
    );
  }
  return header;
}

// Fingerprint of the request body, so a key reused for a *different*
// request can be told apart from a genuine retry
export function fingerprint(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
