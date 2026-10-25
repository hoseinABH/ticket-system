import request from 'supertest';
import { eq, isNull } from 'drizzle-orm';
import {
  bookings,
  notifications,
  outboxMessages,
} from '../src/core/database/schema';
import {
  book,
  checkout,
  createFlight,
  createQuote,
  registerAndLogin,
} from './helpers/fixtures';
import { createTestApp, type TestContext } from './helpers/test-app';

// Nothing listens on port 1, so this app instance can never reach a broker
const UNREACHABLE_BROKER = 'amqp://127.0.0.1:1';

describe('Transactional outbox (e2e)', () => {
  let ctx: TestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    token = await registerAndLogin(ctx, 'traveller@example.com');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const outboxFor = async (bookingId: string) =>
    (await ctx.db.select().from(outboxMessages)).filter(
      (m) => (m.payload as { bookingId: string }).bookingId === bookingId,
    );

  const notificationsFor = (bookingId: string) =>
    ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.bookingId, bookingId));

  const eventually = (assertion: () => Promise<void>) =>
    vi.waitFor(assertion, { timeout: 15_000, interval: 50 });

  it('records the event with the booking, then delivers it', async () => {
    const flight = await createFlight(ctx, 'OB-001', 6);
    const booking = await book(ctx, token, flight.id, ['1A', '1B']);

    const [event] = await outboxFor(booking.id);
    expect(event).toMatchObject({
      type: 'booking.confirmed',
      payload: { pnr: booking.pnr, seatNumbers: ['1A', '1B'] },
    });

    await eventually(async () => {
      const [sent] = await notificationsFor(booking.id);
      expect(sent).toMatchObject({
        messageId: event.id, // the outbox row ID travels as the message ID
        type: 'booking.confirmed',
      });
      expect(sent.body).toContain(booking.pnr);
    });
    const [published] = await outboxFor(booking.id);
    expect(published.publishedAt).not.toBeNull();
  });

  it('records no event when the booking rolls back', async () => {
    const flight = await createFlight(ctx, 'OB-002', 6);
    const quote = await createQuote(ctx, token, flight.id, ['1A']);
    await book(ctx, token, flight.id, ['1A']); // seat taken in between

    await checkout(ctx, token, quote).expect(409);

    const flightBookings = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.flightId, flight.id));
    expect(flightBookings).toHaveLength(1);
    // Exactly one event on this flight: the successful booking's
    const events = (await ctx.db.select().from(outboxMessages)).filter(
      (m) =>
        (m.payload as { pnr: string }).pnr !== undefined &&
        flightBookings.some(
          (b) => b.id === (m.payload as { bookingId: string }).bookingId,
        ),
    );
    expect(events).toHaveLength(1);
  });

  it('delivers cancellation events too', async () => {
    const flight = await createFlight(ctx, 'OB-003', 6);
    const booking = await book(ctx, token, flight.id, ['1C']);

    await request(ctx.app.getHttpServer())
      .post(`/bookings/${booking.id}/cancel`)
      .auth(token, { type: 'bearer' })
      .expect(200);

    await eventually(async () => {
      const sent = await notificationsFor(booking.id);
      expect(sent.map((n) => n.type).sort()).toEqual([
        'booking.cancelled',
        'booking.confirmed',
      ]);
    });
  });

  it('survives a broker outage and a process restart without losing events', async () => {
    // An app instance whose broker is unreachable still takes bookings: the
    // events wait in the outbox table, not in process memory
    await ctx.restart({ RABBITMQ_URL: UNREACHABLE_BROKER });
    const flight = await createFlight(ctx, 'OB-004', 6);
    const booking = await book(ctx, token, flight.id, ['1A']);

    // Give the relay ~20 polls: still nothing can be published
    await new Promise((r) => setTimeout(r, 1000));
    const [pending] = await outboxFor(booking.id);
    expect(pending.publishedAt).toBeNull();
    expect(await notificationsFor(booking.id)).toHaveLength(0);

    // The process dies; a new one starts with the broker reachable again.
    // With an in-memory emit, this event would be gone for good.
    await ctx.restart();

    await eventually(async () => {
      expect(await notificationsFor(booking.id)).toHaveLength(1);
    });
  });

  it('absorbs redelivery: a re-published event notifies only once', async () => {
    const flight = await createFlight(ctx, 'OB-005', 6);
    const booking = await book(ctx, token, flight.id, ['1D']);
    await eventually(async () => {
      expect(await notificationsFor(booking.id)).toHaveLength(1);
    });

    // Simulate the crash window: the broker got the message, but the relay
    // died before recording published_at, so it publishes it again
    const [event] = await outboxFor(booking.id);
    await ctx.db
      .update(outboxMessages)
      .set({ publishedAt: null })
      .where(eq(outboxMessages.id, event.id));
    await eventually(async () => {
      const unpublished = await ctx.db
        .select()
        .from(outboxMessages)
        .where(isNull(outboxMessages.publishedAt));
      expect(unpublished.map((m) => m.id)).not.toContain(event.id);
    });
    // Let the duplicate reach the consumer before counting
    await new Promise((r) => setTimeout(r, 500));

    expect(await notificationsFor(booking.id)).toHaveLength(1);
  });
});
