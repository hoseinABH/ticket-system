import { Module } from '@nestjs/common';
import { FakePaymentProvider } from './fake-payment-provider';
import { PAYMENT_PROVIDER } from './payment-provider';
import { PaymentsService } from './payments.service';

@Module({
  providers: [
    PaymentsService,
    // Swap for a real provider's adapter; nothing else needs to change
    { provide: PAYMENT_PROVIDER, useClass: FakePaymentProvider },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
