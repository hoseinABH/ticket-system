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
  Headers,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  parseIdempotencyKey,
} from '../../core/http/idempotency';
import { BookingsService } from './bookings.service';
import { CheckoutBookingDto } from './dto/bookings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'A new UUID per purchase, reused unchanged on every retry of it',
  })
  @Post('checkout')
  async checkout(
    @Req() req: { user: { userId: string } },
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() dto: CheckoutBookingDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { booking, replayed } = await this.bookingsService.checkout(
      req.user.userId,
      dto.quoteToken,
      parseIdempotencyKey(idempotencyKey),
    );
    if (replayed) {
      res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    }
    return booking;
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
