import request from 'supertest';
import { eq } from 'drizzle-orm';
import { bookings, seats } from '../src/core/database/schema';
import {
  book,
  checkout,
  createFlight,
  createQuote,
  freeSeatCount,
  registerAndLogin,
} from './helpers/fixtures';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Booking checkout (e2e)', () => {
  let ctx: TestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    token = await registerAndLogin(ctx, 'buyer@example.com');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const http = () => request(ctx.app.getHttpServer());

  it('books the chosen seats and shows them in my bookings', async () => {
    const flight = await createFlight(ctx, 'TS-001', 12);

    const booking = await book(ctx, token, flight.id, ['2C', '2D']);

    expect(booking.seatNumbers).toEqual(['2C', '2D']);
    expect(booking.status).toBe('CONFIRMED');
    expect(await freeSeatCount(ctx, flight.id)).toBe(10);

    const mine = await http()
      .get('/bookings/my-bookings')
      .auth(token, { type: 'bearer' })
      .expect(200);
    const listed = mine.body.find((b: { id: string }) => b.id === booking.id);
    expect(listed.seatNumbers).toEqual(['2C', '2D']);
  });

  it('never sells the same seat twice: 20 concurrent checkouts for 1A', async () => {
    const flight = await createFlight(ctx, 'TS-002', 6);

    // Seat 1A is free at quote time, so all 20 quotes succeed
    const quoteTokens = await Promise.all(
      Array.from({ length: 20 }, () =>
        createQuote(ctx, token, flight.id, ['1A']),
      ),
    );

    const responses = await Promise.all(
      quoteTokens.map((q) => checkout(ctx, token, q)),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);

    const flightBookings = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.flightId, flight.id));
    expect(flightBookings).toHaveLength(1);
  });

  it('books different seats on one flight concurrently', async () => {
    const flight = await createFlight(ctx, 'TS-003', 12);
    const wanted = ['1A', '1B', '1C', '1D', '1E', '1F', '2A', '2B'];

    const quoteTokens = await Promise.all(
      wanted.map((seat) => createQuote(ctx, token, flight.id, [seat])),
    );
    const responses = await Promise.all(
      quoteTokens.map((q) => checkout(ctx, token, q)),
    );

    // Seat-level locks: no booking blocks another, so all of them succeed
    expect(responses.map((r) => r.status)).toEqual(wanted.map(() => 201));
    expect(await freeSeatCount(ctx, flight.id)).toBe(4);
  });

  it('resolves overlapping seat requests without deadlocking', async () => {
    // Pairs ask for the same two seats in opposite orders. Seats are locked
    // in a fixed order, so one checkout wins cleanly and the other gets a
    // business error, never a Postgres deadlock (40P01).
    const flight = await createFlight(ctx, 'TS-004', 30);
    const pairs = [
      ['1A', '1B'],
      ['2A', '2B'],
      ['3A', '3B'],
      ['4A', '4B'],
      ['5A', '5B'],
    ];

    const quoteTokens = await Promise.all(
      pairs.flatMap(([x, y]) => [
        createQuote(ctx, token, flight.id, [x, y]),
        createQuote(ctx, token, flight.id, [y, x]),
      ]),
    );
    const responses = await Promise.all(
      quoteTokens.map((q) => checkout(ctx, token, q)),
    );

    for (let i = 0; i < responses.length; i += 2) {
      const pair = [responses[i], responses[i + 1]];
      expect(pair.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      const loser = pair.find((r) => r.status === 409)!;
      expect(loser.body.message).toMatch(/no longer available/);
    }
  });

  it('rejects replaying a quote token', async () => {
    const flight = await createFlight(ctx, 'TS-005', 6);
    const quoteToken = await createQuote(ctx, token, flight.id, ['1A', '1B']);

    await checkout(ctx, token, quoteToken).expect(201);
    const replay = await checkout(ctx, token, quoteToken).expect(400);

    expect(replay.body.message).toMatch(/invalid, expired, or already used/);
    expect(await freeSeatCount(ctx, flight.id)).toBe(4);
  });

  it('refuses to quote taken or unknown seats', async () => {
    const flight = await createFlight(ctx, 'TS-006', 6);
    await book(ctx, token, flight.id, ['1A']);

    const quote = (seatNumbers: string[]) =>
      http()
        .post('/flights/quote')
        .auth(token, { type: 'bearer' })
        .send({ flightId: flight.id, seatNumbers });

    const taken = await quote(['1A', '1B']).expect(409);
    expect(taken.body.message).toMatch(/already taken: 1A/);
    const unknown = await quote(['9A']).expect(400);
    expect(unknown.body.message).toMatch(/do not exist on this flight: 9A/);
    await quote(['1a']).expect(400);
    await quote(['1B', '1B']).expect(400);
  });

  it('serves a seat map without exposing who holds a seat', async () => {
    const flight = await createFlight(ctx, 'TS-007', 7);
    await book(ctx, token, flight.id, ['1F']);

    const res = await http().get(`/flights/${flight.id}/seats`).expect(200);

    expect(res.body.map((s: { seatNumber: string }) => s.seatNumber)).toEqual([
      '1A',
      '1B',
      '1C',
      '1D',
      '1E',
      '1F',
      '2A',
    ]);
    expect(res.body[5]).toEqual({ seatNumber: '1F', available: false });
    expect(res.body[0]).toEqual({ seatNumber: '1A', available: true });
  });

  it('reports availability computed from seats in search results', async () => {
    const flight = await createFlight(ctx, 'TS-008', 6);
    await book(ctx, token, flight.id, ['1A', '1B']);

    const res = await http()
      .get('/flights/search')
      .query({ origin: 'thr', destination: 'ist' })
      .expect(200);

    const found = res.body.find((f: { id: string }) => f.id === flight.id);
    expect(found.availableSeats).toBe(4);
  });

  it('requires authentication', async () => {
    await http()
      .post('/bookings/checkout')
      .send({ quoteToken: 'quote_x' })
      .expect(401);
  });

  it('keeps one booking per seat in the database', async () => {
    const flight = await createFlight(ctx, 'TS-009', 6);
    const booking = await book(ctx, token, flight.id, ['1A', '1B', '1C']);

    const held = await ctx.db
      .select()
      .from(seats)
      .where(eq(seats.bookingId, booking.id));
    expect(held.map((s) => s.seatNumber).sort()).toEqual(['1A', '1B', '1C']);
  });
});
