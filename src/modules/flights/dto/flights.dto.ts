import { IsInt, IsString, IsUUID, Length, Min, Max } from 'class-validator';

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

  @IsInt()
  @Min(1)
  @Max(9)
  seatCount!: number;
}
