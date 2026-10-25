import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnv, type Env } from './core/config/env.js';
import { AllExceptionsFilter } from './core/http/all-exceptions.filter.js';
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
  providers: [
    AppService,
    // Registered here rather than in main.ts so tests that build the app
    // from AppModule get the exact same validation and error handling
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
