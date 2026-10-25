import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

// Postgres SQLSTATE codes we can translate into a meaningful client error.
// Full list: https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_ERROR_MAP: Record<string, { status: HttpStatus; message: string }> = {
  '23505': { status: HttpStatus.CONFLICT, message: 'Resource already exists' },
  '23503': {
    status: HttpStatus.CONFLICT,
    message: 'Referenced resource does not exist',
  },
  '23514': {
    status: HttpStatus.CONFLICT,
    message: 'Request violates a business rule',
  },
  '22P02': { status: HttpStatus.BAD_REQUEST, message: 'Malformed input' },
  '40001': {
    status: HttpStatus.CONFLICT,
    message: 'Concurrent update detected, please retry',
  },
  '40P01': {
    status: HttpStatus.CONFLICT,
    message: 'Concurrent update detected, please retry',
  },
};

// Drizzle wraps driver errors (DrizzleQueryError -> cause: pg DatabaseError),
// so walk the cause chain looking for a SQLSTATE code.
function findPgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();

    const { status, message } = this.resolve(exception);

    if (status >= 500) {
      // Log the real cause server-side; never leak it to the client
      this.logger.error(
        `${httpAdapter.getRequestMethod(request)} ${httpAdapter.getRequestUrl(request)}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message,
      path: httpAdapter.getRequestUrl(request),
      timestamp: new Date().toISOString(),
    };
    httpAdapter.reply(ctx.getResponse(), body, status);
  }

  private resolve(exception: unknown): {
    status: number;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ??
            exception.message);
      return { status: exception.getStatus(), message };
    }

    const pgCode = findPgErrorCode(exception);
    const mapped = pgCode ? PG_ERROR_MAP[pgCode] : undefined;
    if (mapped) {
      return { status: mapped.status, message: mapped.message };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}
