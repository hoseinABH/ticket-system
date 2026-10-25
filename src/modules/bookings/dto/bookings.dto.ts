import { IsNotEmpty, IsString } from 'class-validator';

export class CheckoutBookingDto {
  @IsString()
  @IsNotEmpty()
  quoteToken!: string;

  /**
   * Card token from the payment provider's client SDK. Test tokens:
   * tok_visa (succeeds), tok_declined, tok_slow (charges but answers after
   * the timeout), tok_unavailable (provider error before charging)
   */
  @IsString()
  @IsNotEmpty()
  paymentToken!: string;
}
