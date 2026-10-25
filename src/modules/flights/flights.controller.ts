import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Param,
  ParseUUIDPipe,
  Patch,
  Headers,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { parseIfMatch, toETag } from '../../core/http/etag';
import { FlightsService } from './flights.service';
import {
  CreateQuoteDto,
  SearchFlightsDto,
  UpdateFlightDto,
} from './dto/flights.dto';
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

  // The ETag is the row version, so it only covers fields stored on the
  // flight row. That is why availability is not part of this response.
  @Get(':id')
  async getFlight(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const flight = await this.flightsService.getFlightById(id);
    res.setHeader('ETag', toETag(flight.version));
    return flight;
  }

  // TODO(phase 3): restrict to admins once roles exist
  @ApiBearerAuth()
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'ETag from GET /flights/{id}, e.g. "1"',
  })
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async updateFlight(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: UpdateFlightDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const flight = await this.flightsService.updateFlight(
      id,
      parseIfMatch(ifMatch),
      dto,
    );
    res.setHeader('ETag', toETag(flight.version));
    return flight;
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
