import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FlightsService } from './flights.service';
import { CreateQuoteDto, SearchFlightsDto } from './dto/flights.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('flights')
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

  @Get(':id/seats')
  getSeatMap(@Param('id', ParseUUIDPipe) id: string) {
    return this.flightsService.getSeatMap(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('quote')
  createQuote(@Body() dto: CreateQuoteDto) {
    return this.flightsService.createFareQuote(dto.flightId, dto.seatNumbers);
  }
}
