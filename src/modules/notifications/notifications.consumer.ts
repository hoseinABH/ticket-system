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
import type { ConsumeMessage } from 'amqplib';
import { DRIZZLE, type DrizzleDB } from '../../core/database/database.module';
import { notifications } from '../../core/database/schema';
import { AMQP } from '../../core/messaging/messaging.module';
import {
  assertTopology,
  NOTIFICATIONS_QUEUE,
  type EventEnvelope,
} from '../../core/messaging/topology';
import {
  BookingEvents,
  type BookingCancelledEvent,
  type BookingConfirmedEvent,
} from '../bookings/booking.events';

type BookingEvent =
  EventEnvelope<BookingConfirmedEvent> | EventEnvelope<BookingCancelledEvent>;

@Injectable()
export class NotificationsConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsConsumer.name);
  private readonly channel: ChannelWrapper;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(AMQP) amqp: AmqpConnectionManager,
  ) {
    this.channel = amqp.createChannel({ setup: assertTopology });
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
      const event = JSON.parse(msg.content.toString()) as BookingEvent;
      const body = this.render(event);

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
      this.logger.error(`Could not handle message: ${String(error)}`);
      // TODO(step 2.3): dead-letter queue. For now the message is dropped
      // rather than requeued, so one bad message cannot loop forever.
      this.channel.nack(msg, false, false);
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
      default:
        throw new Error(`Unknown event type ${event.type}`);
    }
  }
}
