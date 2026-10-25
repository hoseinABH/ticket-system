import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PaymentDeclinedError,
  PaymentProviderUnavailableError,
  type Charge,
  type PaymentProvider,
} from './payment-provider';

// Test card tokens, in the spirit of Stripe's test mode
export const TestCards = {
  // Charges successfully
  Visa: 'tok_visa',
  // Declined by the issuer
  Declined: 'tok_declined',
  // Charges, but the response arrives long after any sane client timeout:
  // the caller cannot know the charge went through
  Slow: 'tok_slow',
  // The provider errors before charging (a 503): outcome unknown to caller
  Unavailable: 'tok_unavailable',
} as const;

const NETWORK_LATENCY_MS = 20;
const SLOW_RESPONSE_MS = 10_000;

// Stands in for a remote provider. Its records live on globalThis, outside
// the app's module graph, so they survive app restarts in tests the way a
// real provider's database survives yours.
const store = ((
  globalThis as { __fakePaymentProvider?: Map<string, Charge> }
).__fakePaymentProvider ??= new Map<string, Charge>());

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  async charge(request: {
    idempotencyKey: string;
    amountCents: number;
    cardToken: string;
  }): Promise<Charge> {
    await sleep(NETWORK_LATENCY_MS);

    const existing = store.get(request.idempotencyKey);
    if (existing) {
      // A repeated request gets the original outcome, never a new charge
      if (existing.status === 'succeeded') return existing;
      throw new PaymentDeclinedError(`Charge is ${existing.status}`);
    }

    switch (request.cardToken) {
      case TestCards.Unavailable:
        throw new PaymentProviderUnavailableError('503 Service Unavailable');
      case TestCards.Declined:
        this.record(request, 'declined');
        throw new PaymentDeclinedError('Card declined by issuer');
      case TestCards.Slow: {
        const charge = this.record(request, 'succeeded');
        await sleep(SLOW_RESPONSE_MS); // the money moved; the answer is late
        return charge;
      }
      case TestCards.Visa:
        return this.record(request, 'succeeded');
      default:
        this.record(request, 'declined');
        throw new PaymentDeclinedError('Unknown card');
    }
  }

  async retrieve(idempotencyKey: string): Promise<Charge | null> {
    await sleep(NETWORK_LATENCY_MS);
    return store.get(idempotencyKey) ?? null;
  }

  async void(idempotencyKey: string): Promise<Charge> {
    await sleep(NETWORK_LATENCY_MS);
    return (
      store.get(idempotencyKey) ??
      this.record({ idempotencyKey, amountCents: 0 }, 'voided')
    );
  }

  private record(
    request: { idempotencyKey: string; amountCents: number },
    status: Charge['status'],
  ): Charge {
    const charge: Charge = {
      id: `ch_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
      idempotencyKey: request.idempotencyKey,
      amountCents: request.amountCents,
      status,
    };
    store.set(request.idempotencyKey, charge);
    return charge;
  }
}
