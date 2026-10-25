import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type AmqpConnectionManager } from 'amqp-connection-manager';
import type { Env } from '../config/env';

export const AMQP = Symbol('AMQP_CONNECTION');

@Global()
@Module({
  providers: [
    {
      provide: AMQP,
      inject: [ConfigService],
      // Connects in the background and keeps reconnecting, so the app boots
      // and keeps taking bookings while the broker is down: events wait in
      // the outbox table until the relay can publish them
      useFactory: (config: ConfigService<Env, true>) => {
        const logger = new Logger('Messaging');
        const connection = connect(
          config.get('RABBITMQ_URL', { infer: true }),
          {
            reconnectTimeInSeconds: 1,
          },
        );
        connection.on('connect', () => logger.log('Connected to RabbitMQ'));
        // Fires on every failed attempt (bad credentials, broker down...);
        // without it a broker that is never reached fails silently
        connection.on('connectFailed', ({ err }) =>
          logger.warn(`Cannot connect to RabbitMQ: ${err.message}`),
        );
        connection.on('disconnect', ({ err }) =>
          logger.warn(
            `Disconnected from RabbitMQ: ${err?.message ?? 'closed'}`,
          ),
        );
        return connection;
      },
    },
  ],
  exports: [AMQP],
})
export class MessagingModule implements OnApplicationShutdown {
  constructor(
    @Inject(AMQP) private readonly connection: AmqpConnectionManager,
  ) {}

  // Last shutdown phase: producers and consumers stop in onModuleDestroy
  async onApplicationShutdown() {
    await this.connection.close();
  }
}
