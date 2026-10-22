import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { FlightsService } from './flights.service';
import { CreateQuoteDto, SearchFlightsDto } from './dto/flights.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Post('seed')
  seed() {
    return this.flightsService.seedSampleFlights();
  }

  @Get('search')
  search(@Query() query: SearchFlightsDto) {
    return this.flightsService.searchFlights(query.origin, query.destination);
  }

  @UseGuards(JwtAuthGuard)
  @Post('quote')
  createQuote(@Body() dto: CreateQuoteDto) {
    return this.flightsService.createFareQuote(dto.flightId, dto.seatCount);
  }
}
