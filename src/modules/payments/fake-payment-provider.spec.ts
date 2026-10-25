import { randomUUID } from 'crypto';
import { FakePaymentProvider, TestCards } from './fake-payment-provider';
import {
  PaymentDeclinedError,
  PaymentProviderUnavailableError,
} from './payment-provider';

describe('FakePaymentProvider', () => {
  const provider = new FakePaymentProvider();
  const charge = (cardToken: string, idempotencyKey = randomUUID()) =>
    provider.charge({ idempotencyKey, amountCents: 1000, cardToken });

  it('charges once per idempotency key', async () => {
    const key = randomUUID();
    const first = await charge(TestCards.Visa, key);
    const repeat = await charge(TestCards.Visa, key);

    expect(first.status).toBe('succeeded');
    expect(repeat.id).toBe(first.id);
  });

  it('declines, and keeps declining the same key', async () => {
    const key = randomUUID();
    await expect(charge(TestCards.Declined, key)).rejects.toThrow(
      PaymentDeclinedError,
    );
    await expect(charge(TestCards.Visa, key)).rejects.toThrow(
      PaymentDeclinedError,
    );
    expect((await provider.retrieve(key))?.status).toBe('declined');
  });

  it('records nothing when unavailable', async () => {
    const key = randomUUID();
    await expect(charge(TestCards.Unavailable, key)).rejects.toThrow(
      PaymentProviderUnavailableError,
    );
    expect(await provider.retrieve(key)).toBeNull();
  });

  it('void blocks a charge that arrives afterwards', async () => {
    // The reconciler gave up on this key; the original request, delayed
    // somewhere in the network, must not be able to charge any more
    const key = randomUUID();
    expect((await provider.void(key)).status).toBe('voided');
    await expect(charge(TestCards.Visa, key)).rejects.toThrow(
      PaymentDeclinedError,
    );
  });

  it('void leaves an existing charge as it is', async () => {
    const key = randomUUID();
    const charged = await charge(TestCards.Visa, key);
    expect(await provider.void(key)).toEqual(charged);
  });
});
