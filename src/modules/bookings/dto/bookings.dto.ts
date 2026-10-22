import { IsNotEmpty, IsString } from 'class-validator';

export class CheckoutBookingDto {
  @IsString()
  @IsNotEmpty()
  quoteToken!: string;
}
