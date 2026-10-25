import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { bookings, notifications } from '../src/core/database/schema';
import {
  FakePaymentProvider,
  TestCards,
} from '../src/modules/payments/fake-payment-provider';
import { PaymentDeclinedError } from '../src/modules/payments/payment-provider';
import {
  checkout,
  createFlight,
  createQuote,
  freeSeatCount,
  registerAndLogin,
} from './helpers/fixtures';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Payment saga (e2e)', () => {
  let ctx: TestContext;
  let token: string;
  // The fake provider keeps its records outside the app (globalThis), so a
  // second instance sees the same charges, like a remote provider would
  const provider = new FakePaymentProvider();

  beforeAll(async () => {
    ctx = await createTestApp();
    token = await registerAndLogin(ctx, 'payer@example.com');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const eventually = <T>(assertion: () => Promise<T>) =>
    vi.waitFor(assertion, { timeout: 15_000, interval: 50 });

  async function bookingById(id: string) {
    const [booking] = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, id));
    return booking;
  }

  async function notificationTypes(bookingId: string) {
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.bookingId, bookingId));
    return rows.map((n) => n.type);
  }

  async function pay(flightNumber: string, card: string, key = randomUUID()) {
    const flight = await createFlight(ctx, flightNumber, 6);
    const quote = await createQuote(ctx, token, flight.id, ['1A', '1B']);
    const res = await checkout(ctx, token, quote, key, card);
    return { flight, quote, key, res };
  }

  it('confirms the booking when the charge succeeds', async () => {
    const { res } = await pay('PY-001', TestCards.Visa);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.paymentId).toMatch(/^ch_/);
    await eventually(async () => {
      expect(await notificationTypes(res.body.id)).toEqual([
        'booking.confirmed',
      ]);
    });
  });

  it('compensates a declined card: seats released, 402, failure event', async () => {
    const { flight, key, quote, res } = await pay('PY-002', TestCards.Declined);

    expect(res.status).toBe(402);
    const [failed] = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.flightId, flight.id));
    expect(failed.status).toBe('PAYMENT_FAILED');
    expect(await freeSeatCount(ctx, flight.id)).toBe(6); // seats given back

    // Retrying the same request replays the same outcome; it does not try
    // the card again. A new attempt needs a new Idempotency-Key.
    await checkout(ctx, token, quote, key, TestCards.Declined).expect(402);
    await eventually(async () => {
      expect(await notificationTypes(failed.id)).toEqual([
        'booking.payment_failed',
      ]);
    });
  });

  it('answers 202 on a timeout, then the reconciler confirms the real charge', async () => {
    const startedAt = Date.now();
    const { flight, quote, key, res } = await pay('PY-003', TestCards.Slow);

    // The provider charged the card but answers in 10 s; we gave up at 200 ms
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('PENDING_PAYMENT');
    expect(await freeSeatCount(ctx, flight.id)).toBe(4); // still held

    // The reconciler asks the provider, finds the charge, and confirms
    await eventually(async () => {
      const booking = await bookingById(res.body.id);
      expect(booking.status).toBe('CONFIRMED');
      expect(booking.paymentId).toMatch(/^ch_/);
    });
    // The client polling with its original key now sees the outcome
    const replay = await checkout(ctx, token, quote, key, TestCards.Slow);
    expect(replay.status).toBe(201);
    expect(replay.body.status).toBe('CONFIRMED');
  });

  it('voids and compensates when the provider never saw the charge', async () => {
    const { flight, res } = await pay('PY-004', TestCards.Unavailable);
    expect(res.status).toBe(202);

    await eventually(async () => {
      expect((await bookingById(res.body.id)).status).toBe('PAYMENT_FAILED');
    });
    expect(await freeSeatCount(ctx, flight.id)).toBe(6);

    // The void left a tombstone: if the original charge request were still
    // wandering the network and arrived now, it could not take money for
    // seats that have already been released
    await expect(
      provider.charge({
        idempotencyKey: res.body.id,
        amountCents: 20000,
        cardToken: TestCards.Visa,
      }),
    ).rejects.toThrow(PaymentDeclinedError);
  });

  it('finishes the saga after the process dies mid-payment', async () => {
    const { res } = await pay('PY-005', TestCards.Slow);
    expect(res.status).toBe(202);

    // Crash: this process never learns the charge succeeded. The next one
    // finds the stuck booking and settles it from the provider's records.
    await ctx.restart();

    await eventually(async () => {
      expect((await bookingById(res.body.id)).status).toBe('CONFIRMED');
    });
  });

  it('refuses to store a confirmed booking without a payment', async () => {
    const { res } = await pay('PY-006', TestCards.Unavailable);
    await expect(
      ctx.db
        .update(bookings)
        .set({ status: 'CONFIRMED' })
        .where(eq(bookings.id, res.body.id)),
    ).rejects.toMatchObject({
      cause: { constraint: 'bookings_confirmed_has_payment' },
    });
  });
});
