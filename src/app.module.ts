import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnv, type Env } from './core/config/env.js';
import { DatabaseModule } from './core/database/database.module.js';
import { RedisModule } from './core/redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { FlightsModule } from './modules/flights/flights.module.js';
import { BookingsModule } from './modules/bookings/bookings.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Tests provide their own env (e.g. Testcontainers URLs)
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    ObserveModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        appKey: config.get('OBSERVE_APP_KEY', { infer: true }) as string,
        appSecret: config.get('OBSERVE_APP_SECRET', { infer: true }) as string,
        serviceId: 'ticket-system',
      }),
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    RedisModule,
    AuthModule,
    FlightsModule,
    BookingsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
