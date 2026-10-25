import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../core/config/env';
import { toCents } from './money';
import {
  PAYMENT_PROVIDER,
  PaymentDeclinedError,
  type PaymentProvider,
} from './payment-provider';

// Everything a payment attempt can end in, from the saga's point of view
export type PaymentOutcome =
  | { status: 'succeeded'; chargeId: string }
  | { status: 'declined'; reason: string }
  // We do not know whether money moved: timeout, 5xx, network error.
  // Never treat this as success or failure; the reconciler finds out.
  | { status: 'unknown'; reason: string };

class PaymentTimeoutError extends Error {}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly timeoutMs: number;

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    config: ConfigService<Env, true>,
  ) {
    this.timeoutMs = config.get('PAYMENT_TIMEOUT_MS', { infer: true });
  }

  // The booking ID is the idempotency key at the provider, so any retry of
  // this call (by us, or by the reconciler) can never charge twice
  async charge(
    bookingId: string,
    amount: string,
    cardToken: string,
  ): Promise<PaymentOutcome> {
    try {
      const charge = await this.withTimeout(
        this.provider.charge({
          idempotencyKey: bookingId,
          amountCents: toCents(amount),
          cardToken,
        }),
      );
      return { status: 'succeeded', chargeId: charge.id };
    } catch (error) {
      if (error instanceof PaymentDeclinedError) {
        return { status: 'declined', reason: error.message };
      }
      // Timeouts, 5xx, connection resets: the charge may or may not exist
      this.logger.warn(
        `Payment outcome unknown for booking ${bookingId}: ${String(error)}`,
      );
      return { status: 'unknown', reason: String(error) };
    }
  }

  // For the reconciler: ask the provider what actually happened. If it has
  // no record, void the key first so a request still in flight cannot
  // charge after we have released the seats.
  async resolve(bookingId: string): Promise<PaymentOutcome> {
    const charge =
      (await this.provider.retrieve(bookingId)) ??
      (await this.provider.void(bookingId));
    return charge.status === 'succeeded'
      ? { status: 'succeeded', chargeId: charge.id }
      : { status: 'declined', reason: `Charge ${charge.status}` };
  }

  // Stops *waiting*, not the request itself: the provider may still process
  // it. That is exactly why a timeout means "unknown", not "failed".
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new PaymentTimeoutError(`No answer in ${this.timeoutMs} ms`)),
        this.timeoutMs,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
}
