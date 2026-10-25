import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import { asc, inArray, isNull } from 'drizzle-orm';
import type { Env } from '../config/env';
import { DRIZZLE, type DrizzleDB } from '../database/database.module';
import { outboxMessages } from '../database/schema';
import { AMQP } from '../messaging/messaging.module';
import {
  assertTopology,
  EVENTS_EXCHANGE,
  type EventEnvelope,
} from '../messaging/topology';

const BATCH_SIZE = 100;
const PUBLISH_TIMEOUT_MS = 5000;

// Polls the outbox table and publishes unpublished events to RabbitMQ.
//
// Delivery is at-least-once: if the process dies after the broker confirmed
// a message but before published_at was committed, the next run publishes it
// again. Consumers must therefore be idempotent (see NotificationsConsumer).
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly channel: ChannelWrapper;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<unknown>;
  private stopped = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(AMQP) private readonly amqp: AmqpConnectionManager,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs = config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
    // A confirm channel: publish() resolves only once the broker has taken
    // responsibility for the message (written it to its queues)
    this.channel = amqp.createChannel({ confirm: true, setup: assertTopology });
  }

  onApplicationBootstrap() {
    this.scheduleNext();
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inFlight; // let the current batch finish and commit
    await this.channel.close();
  }

  // setTimeout chained after each run, not setInterval: a slow batch can
  // never overlap with the next one
  private scheduleNext() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.publishBatch()
        .catch((error) =>
          this.logger.warn(`Outbox publish failed, will retry: ${error}`),
        )
        .finally(() => this.scheduleNext());
    }, this.intervalMs);
  }

  async publishBatch(): Promise<number> {
    // Broker down: leave everything in the outbox. Publishing anyway would
    // only park messages in the client's in-memory buffer, which a crash
    // loses; the outbox table is the durable buffer.
    if (!this.amqp.isConnected()) return 0;

    return this.db.transaction(async (tx) => {
      // SKIP LOCKED: several app instances can relay at once. Each one claims
      // rows nobody else holds and skips the rest instead of waiting.
      const batch = await tx
        .select()
        .from(outboxMessages)
        .where(isNull(outboxMessages.publishedAt))
        .orderBy(asc(outboxMessages.createdAt), asc(outboxMessages.id))
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });

      for (const message of batch) {
        const envelope: EventEnvelope = {
          id: message.id,
          type: message.type,
          occurredAt: message.createdAt.toISOString(),
          payload: message.payload,
        };
        // A failure throws, rolling back this transaction: the whole batch
        // stays unpublished and is retried on the next run
        await this.channel.publish(
          EVENTS_EXCHANGE,
          message.type,
          Buffer.from(JSON.stringify(envelope)),
          {
            persistent: true, // survives a broker restart
            messageId: message.id,
            contentType: 'application/json',
            timeout: PUBLISH_TIMEOUT_MS,
          },
        );
      }

      if (batch.length > 0) {
        await tx
          .update(outboxMessages)
          .set({ publishedAt: new Date() })
          .where(
            inArray(
              outboxMessages.id,
              batch.map((m) => m.id),
            ),
          );
      }
      return batch.length;
    });
  }
}
