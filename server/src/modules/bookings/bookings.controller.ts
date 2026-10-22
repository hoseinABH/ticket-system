import { Controller, Post, Get, Body, UseGuards, Req } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CheckoutBookingDto } from './dto/bookings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('checkout')
  checkout(
    @Req() req: { user: { userId: string } },
    @Body() dto: CheckoutBookingDto,
  ) {
    return this.bookingsService.checkout(req.user.userId, dto.quoteToken);
  }

  @Get('my-bookings')
  getMyBookings(@Req() req: { user: { userId: string } }) {
    return this.bookingsService.getUserBookings(req.user.userId);
  }
}
