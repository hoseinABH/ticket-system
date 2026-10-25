import type { ConfirmChannel } from 'amqplib';
import { assertRetryTopology } from './retry';

// The broker's "schema": every exchange, queue and binding the app relies on.
// Declarations are idempotent, so every channel asserts the full topology on
// (re)connect. That way a publisher can never publish into an exchange whose
// queues have not been bound yet, which would silently drop the message.

// Topic exchange for domain events; the routing key is the event type
export const EVENTS_EXCHANGE = 'ticket-system.events';

export const NOTIFICATIONS_QUEUE = 'notifications.booking-events';

// Returns a channel setup function; retry queue names depend on the delays
export function topology(retryDelaysMs: number[]) {
  return async (channel: ConfirmChannel) => {
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await channel.assertQueue(NOTIFICATIONS_QUEUE, { durable: true });
    await channel.bindQueue(NOTIFICATIONS_QUEUE, EVENTS_EXCHANGE, 'booking.*');
    await assertRetryTopology(channel, NOTIFICATIONS_QUEUE, retryDelaysMs);
  };
}

// What travels on the wire. `id` is the outbox row ID: stable across
// redeliveries, so consumers use it to detect duplicates.
export interface EventEnvelope<T = unknown> {
  id: string;
  type: string;
  occurredAt: string;
  payload: T;
}
