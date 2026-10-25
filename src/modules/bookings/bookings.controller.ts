import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CheckoutBookingDto } from './dto/bookings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('bookings')
@ApiBearerAuth()
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

  // An action endpoint rather than PATCH { status }: clients ask for a
  // business operation, and the server decides what state change it means
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Req() req: { user: { userId: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bookingsService.cancel(req.user.userId, id);
  }
}
