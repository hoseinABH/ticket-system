import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { FlightsModule } from '../flights/flights.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [FlightsModule, AuthModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
