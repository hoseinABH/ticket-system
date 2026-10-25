import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { bookings, flights, seats } from '../src/core/database/schema';
import {
  book,
  createFlight,
  freeSeatCount,
  registerAndLogin,
} from './helpers/fixtures';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Booking cancellation (e2e)', () => {
  let ctx: TestContext;
  let owner: string;
  let stranger: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerAndLogin(ctx, 'owner@example.com');
    stranger = await registerAndLogin(ctx, 'stranger@example.com');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  function cancel(token: string, bookingId: string) {
    return request(ctx.app.getHttpServer())
      .post(`/bookings/${bookingId}/cancel`)
      .auth(token, { type: 'bearer' });
  }

  it('cancels a booking and returns its seats', async () => {
    const flight = await createFlight(ctx, 'CX-001', 10);
    const booking = await book(ctx, owner, flight.id, ['1A', '1B', '1C']);
    expect(await freeSeatCount(ctx, flight.id)).toBe(7);

    const res = await cancel(owner, booking.id).expect(200);

    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.seatNumbers).toEqual(['1A', '1B', '1C']);
    expect(res.body.cancelledAt).toBeDefined();
    expect(await freeSeatCount(ctx, flight.id)).toBe(10);
  });

  async function sessionsWaitingOnLocks() {
    const result = await ctx.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    return result.rows[0].count;
  }

  it('releases seats exactly once when concurrent cancels race', async () => {
    const flight = await createFlight(ctx, 'CX-002', 10);
    const booking = await book(ctx, owner, flight.id, ['1A', '1B']);
    const racers = 5;

    // Firing requests at once is not enough to prove anything: the first one
    // often commits before the others even pass the pre-check, so the guard
    // in the UPDATE is never exercised. Instead, hold the booking's row lock
    // so every request passes the pre-check and then blocks on its UPDATE,
    // wait until Postgres reports all of them waiting, and only then let go.
    const { inFlight } = await ctx.db.transaction(async (tx) => {
      await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, booking.id))
        .for('update');

      const requests = Promise.all(
        Array.from({ length: racers }, () => cancel(owner, booking.id)),
      );
      await vi.waitFor(
        async () => expect(await sessionsWaitingOnLocks()).toBe(racers),
        { timeout: 10_000, interval: 50 },
      );
      // Wrapped in an object: returning the bare promise would make the
      // transaction wait for requests that are waiting for its lock (deadlock)
      return { inFlight: requests };
    });
    // The transaction has committed and released the lock; let them race
    const statuses = (await inFlight).map((r) => r.status);

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(racers - 1);
    // Releasing seats is idempotent (it frees rows WHERE booking_id = id),
    // so a double cancel no longer inflates availability; the status
    // assertions above are what catch it
    expect(await freeSeatCount(ctx, flight.id)).toBe(10);
  });

  it("hides other users' bookings behind a 404", async () => {
    const flight = await createFlight(ctx, 'CX-003', 10);
    const booking = await book(ctx, owner, flight.id, ['1A']);

    await cancel(stranger, booking.id).expect(404);

    const [stored] = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(stored.status).toBe('CONFIRMED');
  });

  it('refuses to cancel after departure', async () => {
    const flight = await createFlight(ctx, 'CX-004', 10);
    const booking = await book(ctx, owner, flight.id, ['1A']);
    await ctx.db
      .update(flights)
      .set({ departureTime: new Date(Date.now() - 60_000) })
      .where(eq(flights.id, flight.id));

    const res = await cancel(owner, booking.id).expect(409);
    expect(res.body.message).toMatch(/after departure/);
  });

  it('rejects a malformed booking id', async () => {
    await cancel(owner, 'not-a-uuid').expect(400);
  });

  describe('database constraints (defense in depth)', () => {
    it('rejects a duplicate seat number on the same flight', async () => {
      const flight = await createFlight(ctx, 'CX-005', 1);
      await expect(
        ctx.db.insert(seats).values({ flightId: flight.id, seatNumber: '1A' }),
      ).rejects.toMatchObject({
        cause: { constraint: 'seats_flight_id_seat_number_unique' },
      });
    });

    it('rejects CANCELLED without cancelled_at', async () => {
      const flight = await createFlight(ctx, 'CX-006', 10);
      const booking = await book(ctx, owner, flight.id, ['1A']);
      await expect(
        ctx.db
          .update(bookings)
          .set({ status: 'CANCELLED' })
          .where(eq(bookings.id, booking.id)),
      ).rejects.toMatchObject({
        cause: { constraint: 'bookings_cancelled_at_matches_status' },
      });
    });
  });
});
