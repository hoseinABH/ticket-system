import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import { ConfigService } from '@nestjs/config';
import type { ConsumeMessage } from 'amqplib';
import type { Env } from '../../core/config/env';
import { DRIZZLE, type DrizzleDB } from '../../core/database/database.module';
import { notifications } from '../../core/database/schema';
import { AMQP } from '../../core/messaging/messaging.module';
import {
  describeError,
  handleFailure,
  PermanentError,
} from '../../core/messaging/retry';
import {
  NOTIFICATIONS_QUEUE,
  topology,
  type EventEnvelope,
} from '../../core/messaging/topology';
import {
  BookingEvents,
  type BookingCancelledEvent,
  type BookingConfirmedEvent,
  type BookingPaymentFailedEvent,
} from '../bookings/booking.events';

type BookingEvent =
  | EventEnvelope<BookingConfirmedEvent>
  | EventEnvelope<BookingCancelledEvent>
  | EventEnvelope<BookingPaymentFailedEvent>;

@Injectable()
export class NotificationsConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsConsumer.name);
  private readonly channel: ChannelWrapper;
  private readonly retryDelaysMs: number[];

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(AMQP) amqp: AmqpConnectionManager,
    config: ConfigService<Env, true>,
  ) {
    this.retryDelaysMs = config.get('MESSAGE_RETRY_DELAYS_MS', { infer: true });
    this.channel = amqp.createChannel({
      setup: topology(this.retryDelaysMs),
    });
  }

  onApplicationBootstrap() {
    // Not awaited: with the broker down, the app still boots, and the
    // consumer starts as soon as the connection comes up
    this.channel
      .consume(NOTIFICATIONS_QUEUE, (msg) => void this.handle(msg), {
        // At most 10 unacknowledged messages in flight per consumer
        prefetch: 10,
      })
      .catch((error) => this.logger.error(`Consumer failed: ${error}`));
  }

  async onModuleDestroy() {
    await this.channel.close();
  }

  private async handle(msg: ConsumeMessage) {
    try {
      const { event, body } = this.parse(msg);

      // Idempotent consumer: the UNIQUE message_id turns a redelivered event
      // into a no-op instead of a second notification
      const inserted = await this.db
        .insert(notifications)
        .values({
          messageId: event.id,
          type: event.type,
          userId: event.payload.userId,
          bookingId: event.payload.bookingId,
          body,
        })
        .onConflictDoNothing({ target: notifications.messageId })
        .returning({ id: notifications.id });

      if (inserted.length > 0) {
        this.logger.log(body); // stands in for sending an email or push
      } else {
        this.logger.debug(`Duplicate event ${event.id} ignored`);
      }
      // Ack only after the work is durable: a crash before this line means
      // the broker redelivers, and the UNIQUE constraint absorbs the repeat
      this.channel.ack(msg);
    } catch (error) {
      try {
        const outcome = await handleFailure(
          this.channel,
          msg,
          NOTIFICATIONS_QUEUE,
          this.retryDelaysMs,
          error,
        );
        const what =
          outcome.action === 'retry'
            ? `retrying in ${outcome.delayMs} ms`
            : 'moved to the dead-letter queue';
        this.logger.warn(
          `Message ${msg.properties.messageId} failed (attempt ${outcome.attempt}), ${what}: ${describeError(error)}`,
        );
      } catch (publishError) {
        // Could not even re-route it (broker trouble). Leaving it unacked
        // means the broker redelivers it once the channel recovers.
        this.logger.error(
          `Could not re-route failed message: ${String(publishError)}`,
        );
      }
    }
  }

  // Everything that can only fail because of the message itself, so any
  // error here is permanent: retrying the same bytes cannot help
  private parse(msg: ConsumeMessage): { event: BookingEvent; body: string } {
    try {
      const event = JSON.parse(msg.content.toString()) as BookingEvent;
      return { event, body: this.render(event) };
    } catch (error) {
      throw new PermanentError(`Unprocessable message: ${String(error)}`);
    }
  }

  private render(event: BookingEvent): string {
    switch (event.type) {
      case BookingEvents.Confirmed: {
        const p = event.payload as BookingConfirmedEvent;
        return `[Ticket Issued] PNR: ${p.pnr} | Flight: ${p.flightNumber} | Seats: ${p.seatNumbers.join(', ')} | Total: $${p.totalPrice}`;
      }
      case BookingEvents.Cancelled: {
        const p = event.payload as BookingCancelledEvent;
        return `[Booking Cancelled] PNR: ${p.pnr} | Seats released: ${p.seatNumbers.join(', ')} | Refund: $${p.refundAmount}`;
      }
      case BookingEvents.PaymentFailed: {
        const p = event.payload as BookingPaymentFailedEvent;
        return `[Payment Failed] PNR: ${p.pnr} | Seats released: ${p.seatNumbers.join(', ')} | Reason: ${p.reason}`;
      }
      default:
        throw new Error(`Unknown event type ${event.type}`);
    }
  }
}
