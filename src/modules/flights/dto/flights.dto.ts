import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDecimal,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { SEAT_NUMBER_PATTERN } from '../domain/seat-layout';

export class SearchFlightsDto {
  @IsString()
  @Length(3, 3)
  origin!: string;

  @IsString()
  @Length(3, 3)
  destination!: string;
}

export class CreateQuoteDto {
  @IsUUID()
  flightId!: string;

  /**
   * Seats to book, e.g. ["12A", "12B"]
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @ArrayUnique()
  @Matches(SEAT_NUMBER_PATTERN, {
    each: true,
    message: 'each seat number must look like 12A (row 1-99, letter A-F)',
  })
  seatNumbers!: string[];
}

// All fields optional; the service rejects an empty update
export class UpdateFlightDto {
  /**
   * New departure time (ISO 8601), e.g. "2026-11-02T14:30:00Z"
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  departureTime?: string;

  /**
   * New base price per seat, e.g. "199.90"
   */
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,2' })
  basePrice?: string;
}
