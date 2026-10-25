// The contract the app needs from a card payment provider. Shaped after real
// ones (Stripe, Adyen): every call is keyed by the caller's idempotency key,
// so repeating a call can never charge twice.

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type ChargeStatus = 'succeeded' | 'declined' | 'voided';

export interface Charge {
  id: string;
  idempotencyKey: string;
  amountCents: number;
  status: ChargeStatus;
}

export class PaymentDeclinedError extends Error {}

// The provider answered with an error and we cannot tell whether it charged
// (think HTTP 503). Not the same as a decline.
export class PaymentProviderUnavailableError extends Error {}

export interface PaymentProvider {
  // Charges once per key. Repeating the call returns the original charge.
  // Throws PaymentDeclinedError or PaymentProviderUnavailableError.
  charge(request: {
    idempotencyKey: string;
    amountCents: number;
    cardToken: string;
  }): Promise<Charge>;

  // What the provider knows about a key; null if it never saw it
  retrieve(idempotencyKey: string): Promise<Charge | null>;

  // Closes a key for good. If nothing was charged under it, records a
  // "voided" tombstone so a charge request still in flight can no longer
  // succeed; if it was charged, returns that charge unchanged.
  void(idempotencyKey: string): Promise<Charge>;
}
