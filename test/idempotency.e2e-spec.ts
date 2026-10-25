import { randomUUID } from 'crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { bookings, idempotencyKeys } from '../src/core/database/schema';
import {
  book,
  checkout,
  createFlight,
  createQuote,
  freeSeatCount,
  registerAndLogin,
} from './helpers/fixtures';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Idempotent checkout (e2e)', () => {
  let ctx: TestContext;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    alice = await registerAndLogin(ctx, 'alice@example.com');
    bob = await registerAndLogin(ctx, 'bob@example.com');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  async function bookingsOn(flightId: string) {
    return ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.flightId, flightId));
  }

  it('replays the original response when a client retries', async () => {
    const flight = await createFlight(ctx, 'ID-001', 6);
    const quote = await createQuote(ctx, alice, flight.id, ['1A', '1B']);
    const key = randomUUID();

    // The first response is "lost" (say, a mobile network drop)...
    const first = await checkout(ctx, alice, quote, key).expect(201);
    // ...so the client retries the same purchase with the same key
    const retry = await checkout(ctx, alice, quote, key).expect(201);

    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await bookingsOn(flight.id)).toHaveLength(1);
    expect(await freeSeatCount(ctx, flight.id)).toBe(4);
  });

  it('books exactly once when duplicates arrive concurrently', async () => {
    // e.g. a double-click, or a retry fired while the first is still running
    const flight = await createFlight(ctx, 'ID-002', 6);
    const quote = await createQuote(ctx, alice, flight.id, ['1A']);
    const key = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => checkout(ctx, alice, quote, key)),
    );

    expect(responses.map((r) => r.status)).toEqual(responses.map(() => 201));
    const bookingIds = new Set(responses.map((r) => r.body.id));
    expect(bookingIds.size).toBe(1);
    const replays = responses.filter(
      (r) => r.headers['idempotent-replayed'] === 'true',
    );
    expect(replays).toHaveLength(9);
    expect(await bookingsOn(flight.id)).toHaveLength(1);
  });

  it('rejects reusing a key for a different request (422)', async () => {
    const flight = await createFlight(ctx, 'ID-003', 6);
    const key = randomUUID();
    const quoteA = await createQuote(ctx, alice, flight.id, ['1A']);
    const quoteB = await createQuote(ctx, alice, flight.id, ['1B']);

    await checkout(ctx, alice, quoteA, key).expect(201);
    const reuse = await checkout(ctx, alice, quoteB, key).expect(422);

    expect(reuse.body.message).toMatch(/different request/);
    expect(await bookingsOn(flight.id)).toHaveLength(1);
  });

  it('scopes keys per user', async () => {
    const flight = await createFlight(ctx, 'ID-004', 6);
    const key = randomUUID();

    await checkout(
      ctx,
      alice,
      await createQuote(ctx, alice, flight.id, ['1A']),
      key,
    ).expect(201);
    const bobs = await checkout(
      ctx,
      bob,
      await createQuote(ctx, bob, flight.id, ['1B']),
      key,
    ).expect(201);

    expect(bobs.headers['idempotent-replayed']).toBeUndefined();
    expect(await bookingsOn(flight.id)).toHaveLength(2);
  });

  it('records nothing when checkout fails, so a retry runs again', async () => {
    const flight = await createFlight(ctx, 'ID-005', 6);
    const quote = await createQuote(ctx, alice, flight.id, ['1A']);
    await book(ctx, bob, flight.id, ['1A']); // Bob takes 1A first
    const key = randomUUID();

    await checkout(ctx, alice, quote, key).expect(409);
    await checkout(ctx, alice, quote, key).expect(409); // not a replay

    const stored = await ctx.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key));
    expect(stored).toHaveLength(0);
  });

  it('keeps the quote usable when checkout fails part-way', async () => {
    // Before this step the quote was deleted *before* the transaction, so
    // any failure inside it destroyed the quote (review item #5)
    const flight = await createFlight(ctx, 'ID-006', 6);
    const quote = await createQuote(ctx, alice, flight.id, ['1A', '1B']);
    const key = randomUUID();

    // Bob grabs 1B; Alice's checkout fails on that seat and rolls back...
    await book(ctx, bob, flight.id, ['1B']);
    await checkout(ctx, alice, quote, key).expect(409);
    // ...Bob cancels, and Alice's retry with the same quote and key works
    const [bobsBooking] = (await bookingsOn(flight.id)).filter(
      (b) => b.status === 'CONFIRMED',
    );
    await request(ctx.app.getHttpServer())
      .post(`/bookings/${bobsBooking.id}/cancel`)
      .auth(bob, { type: 'bearer' })
      .expect(200);

    const retry = await checkout(ctx, alice, quote, key).expect(201);
    expect(retry.body.seatNumbers).toEqual(['1A', '1B']);
  });

  it('requires a well-formed Idempotency-Key header', async () => {
    const flight = await createFlight(ctx, 'ID-007', 6);
    const quote = await createQuote(ctx, alice, flight.id, ['1A']);
    const http = () =>
      request(ctx.app.getHttpServer())
        .post('/bookings/checkout')
        .auth(alice, { type: 'bearer' });

    const missing = await http().send({ quoteToken: quote }).expect(400);
    expect(missing.body.message).toMatch(/Idempotency-Key header is required/);
    await http()
      .set('Idempotency-Key', 'bad key!')
      .send({ quoteToken: quote })
      .expect(400);
    expect(await bookingsOn(flight.id)).toHaveLength(0);
  });
});
