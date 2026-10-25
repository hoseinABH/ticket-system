import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
