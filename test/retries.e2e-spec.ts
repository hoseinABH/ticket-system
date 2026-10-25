import { randomUUID } from 'crypto';
import {
  connect,
  type Channel,
  type ChannelModel,
  type GetMessage,
} from 'amqplib';
import { eq, sql } from 'drizzle-orm';
import { notifications } from '../src/core/database/schema';
import {
  LAST_ERROR_HEADER,
  RETRY_COUNT_HEADER,
  deadLetterQueueName,
} from '../src/core/messaging/retry';
import {
  EVENTS_EXCHANGE,
  NOTIFICATIONS_QUEUE,
} from '../src/core/messaging/topology';
import { book, createFlight, registerAndLogin } from './helpers/fixtures';
import { createTestApp, type TestContext } from './helpers/test-app';

const DLQ = deadLetterQueueName(NOTIFICATIONS_QUEUE);
// Short backoff so the whole retry ladder takes ~1.2 s in tests
const RETRY_DELAYS_MS = [200, 400, 600];

describe('Consumer retries and dead-letter queue (e2e)', () => {
  let ctx: TestContext;
  let token: string;
  let broker: ChannelModel;
  let channel: Channel;

  beforeAll(async () => {
    ctx = await createTestApp({
      MESSAGE_RETRY_DELAYS_MS: RETRY_DELAYS_MS.join(','),
    });
    token = await registerAndLogin(ctx, 'retry@example.com');
    // A separate connection, standing in for an operator or a bad producer
    broker = await connect(process.env.RABBITMQ_URL!);
    channel = await broker.createChannel();
  });

  afterAll(async () => {
    await broker?.close();
    await ctx?.close();
  });

  const eventually = <T>(assertion: () => Promise<T>) =>
    vi.waitFor(assertion, { timeout: 15_000, interval: 50 });

  const notificationsFor = (bookingId: string) =>
    ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.bookingId, bookingId));

  // Makes the consumer's INSERT fail the way a database problem would
  // (42P01 "relation does not exist"), until the table is restored
  const breakStorage = () =>
    ctx.db.execute(
      sql`ALTER TABLE notifications.notifications RENAME TO notifications_down`,
    );
  const restoreStorage = () =>
    ctx.db.execute(
      sql`ALTER TABLE notifications.notifications_down RENAME TO notifications`,
    );

  async function nextDeadLetter(): Promise<GetMessage> {
    return eventually(async () => {
      const message = await channel.get(DLQ, { noAck: true });
      if (!message) throw new Error('DLQ still empty');
      return message;
    });
  }

  it('dead-letters a poison message at once and keeps the queue moving', async () => {
    const messageId = randomUUID();
    channel.publish(
      EVENTS_EXCHANGE,
      'booking.confirmed',
      Buffer.from('{not json'),
      {
        messageId,
        persistent: true,
      },
    );
    // A healthy event published right behind the poison one
    const flight = await createFlight(ctx, 'RT-001', 6);
    const booking = await book(ctx, token, flight.id, ['1A']);

    const dead = await nextDeadLetter();
    expect(dead.properties.messageId).toBe(messageId);
    // Permanent error: no retries were wasted on it
    expect(dead.properties.headers?.[RETRY_COUNT_HEADER]).toBe(0);
    expect(String(dead.properties.headers?.[LAST_ERROR_HEADER])).toMatch(
      /Unprocessable message/,
    );
    await eventually(async () => {
      expect(await notificationsFor(booking.id)).toHaveLength(1);
    });
  });

  it('recovers from a transient failure by retrying with backoff', async () => {
    await breakStorage();
    const flight = await createFlight(ctx, 'RT-002', 6);
    const booking = await book(ctx, token, flight.id, ['1A']);

    // Long enough for the first attempt and at least one retry to fail
    await new Promise((r) => setTimeout(r, 400));
    await restoreStorage();

    // A later retry succeeds: nothing was lost, nothing was dead-lettered
    await eventually(async () => {
      expect(await notificationsFor(booking.id)).toHaveLength(1);
    });
    expect(await channel.get(DLQ, { noAck: true })).toBe(false);
  });

  it('dead-letters after the last retry when the failure persists', async () => {
    await breakStorage();
    const flight = await createFlight(ctx, 'RT-003', 6);
    const booking = await book(ctx, token, flight.id, ['1A']);
    const startedAt = Date.now();

    const dead = await nextDeadLetter();
    await restoreStorage();

    const envelope = JSON.parse(dead.content.toString());
    expect(envelope.payload.bookingId).toBe(booking.id);
    expect(dead.properties.headers?.[RETRY_COUNT_HEADER]).toBe(
      RETRY_DELAYS_MS.length,
    );
    expect(String(dead.properties.headers?.[LAST_ERROR_HEADER])).toMatch(
      /does not exist/,
    );
    // It really waited out the whole backoff ladder (200 + 400 + 600 ms)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1200);
    expect(await notificationsFor(booking.id)).toHaveLength(0);
  });
});
