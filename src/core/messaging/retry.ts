import type { ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

// Delayed retries and a dead-letter queue (DLQ), built from plain RabbitMQ
// parts: one "wait queue" per backoff step whose messages expire after its
// TTL and are then dead-lettered back into the work queue.

// A failure that no retry can fix (malformed message, unknown event type).
// Goes straight to the DLQ instead of wasting retries and delaying others.
export class PermanentError extends Error {}

export const RETRY_COUNT_HEADER = 'x-retry-count';
export const LAST_ERROR_HEADER = 'x-last-error';

// The delay is part of the name on purpose: queue arguments such as the TTL
// cannot change once declared (redeclaring fails with 406 PRECONDITION_FAILED),
// so a new delay gets a new queue rather than a broken redeclaration
export const retryQueueName = (queue: string, delayMs: number) =>
  `${queue}.retry.${delayMs}ms`;

export const deadLetterQueueName = (queue: string) => `${queue}.dlq`;

export async function assertRetryTopology(
  channel: ConfirmChannel,
  queue: string,
  delaysMs: number[],
) {
  for (const delayMs of delaysMs) {
    await channel.assertQueue(retryQueueName(queue, delayMs), {
      durable: true,
      arguments: {
        // A per-queue TTL expires messages strictly in order. A per-message
        // TTL would let one long-delay message hold up shorter ones behind it.
        'x-message-ttl': delayMs,
        // On expiry, route back to the work queue via the default exchange
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queue,
      },
    });
  }
  await channel.assertQueue(deadLetterQueueName(queue), { durable: true });
}

// Innermost cause first: wrappers like DrizzleQueryError put the SQL text
// in their own message and the actual reason ("relation ... does not
// exist") in `cause`, which would otherwise be cut off by the length limit
export function describeError(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    messages.unshift(
      current instanceof Error ? current.message : JSON.stringify(current),
    );
    current = (current as { cause?: unknown }).cause;
  }
  return messages.join(' <- ').slice(0, 500);
}

export type FailureOutcome =
  | { action: 'retry'; attempt: number; delayMs: number }
  | { action: 'dead-letter'; attempt: number };

// Retry with the next backoff step, or dead-letter once retries run out or
// the error is permanent
export function decideOnFailure(
  retriesSoFar: number,
  delaysMs: number[],
  error: unknown,
): FailureOutcome {
  const attempt = retriesSoFar + 1;
  if (error instanceof PermanentError || retriesSoFar >= delaysMs.length) {
    return { action: 'dead-letter', attempt };
  }
  return { action: 'retry', attempt, delayMs: delaysMs[retriesSoFar] };
}

// Re-publishes the message where decideOnFailure says, then acks the
// original. Publish-then-ack is not atomic: a crash in between redelivers
// the original as well, so this relies on the consumer being idempotent.
export async function handleFailure(
  channel: ChannelWrapper,
  msg: ConsumeMessage,
  queue: string,
  delaysMs: number[],
  error: unknown,
): Promise<FailureOutcome> {
  const headers = msg.properties.headers ?? {};
  const retriesSoFar = Number(headers[RETRY_COUNT_HEADER] ?? 0);
  const outcome = decideOnFailure(retriesSoFar, delaysMs, error);

  const target =
    outcome.action === 'retry'
      ? retryQueueName(queue, outcome.delayMs)
      : deadLetterQueueName(queue);

  await channel.sendToQueue(target, msg.content, {
    persistent: true,
    messageId: msg.properties.messageId,
    contentType: msg.properties.contentType,
    headers: {
      ...headers,
      [RETRY_COUNT_HEADER]:
        outcome.action === 'retry' ? retriesSoFar + 1 : retriesSoFar,
      [LAST_ERROR_HEADER]: describeError(error),
    },
  });
  channel.ack(msg);
  return outcome;
}
