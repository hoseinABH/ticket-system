import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { PaymentReconciler } from './payment-reconciler';
import { FlightsModule } from '../flights/flights.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [FlightsModule, AuthModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, PaymentReconciler],
})
export class BookingsModule {}
