import {
  HttpException,
  HttpStatus,
  PreconditionFailedException,
} from '@nestjs/common';

// Version-based entity tags for optimistic concurrency over HTTP.
// GET returns `ETag: "<version>"`; a write must echo it in `If-Match`.

export function toETag(version: number): string {
  return `"${version}"`;
}

// Returns the version a client last saw, or throws:
// 428 if the header is missing (the client must prove what it read),
// 412 if it is not a version tag (it can never match).
export function parseIfMatch(header: string | undefined): number {
  if (header === undefined || header.trim() === '') {
    throw new HttpException(
      'If-Match header is required: send the ETag from your last GET',
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  const match = /^"(\d+)"$/.exec(header.trim());
  if (!match) {
    throw new PreconditionFailedException(
      'If-Match must be a strong ETag such as "3"',
    );
  }
  return Number(match[1]);
}
