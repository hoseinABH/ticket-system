import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, lt } from 'drizzle-orm';
import type { Env } from '../../core/config/env';
import { DRIZZLE, type DrizzleDB } from '../../core/database/database.module';
import { bookings } from '../../core/database/schema';
import { PaymentsService } from '../payments/payments.service';
import { BookingsService } from './bookings.service';

const BATCH_SIZE = 50;

// Settles bookings stuck in PENDING_PAYMENT: the checkout request timed out
// waiting for the provider, got a 5xx, or the process died between charging
// and confirming. It asks the provider what really happened (voiding the
// key if the provider never saw it) and then confirms or compensates.
@Injectable()
export class PaymentReconciler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PaymentReconciler.name);
  private readonly intervalMs: number;
  // Only bookings older than this: by then the request that created them
  // has stopped waiting for the provider, so we are not racing it
  private readonly graceMs: number;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<unknown>;
  private stopped = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly payments: PaymentsService,
    private readonly bookingsService: BookingsService,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs = config.get('PAYMENT_RECONCILE_INTERVAL_MS', {
      infer: true,
    });
    this.graceMs = 2 * config.get('PAYMENT_TIMEOUT_MS', { infer: true });
  }

  onApplicationBootstrap() {
    this.scheduleNext();
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inFlight;
  }

  private scheduleNext() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.reconcile()
        .catch((error) =>
          this.logger.warn(`Reconciliation failed, will retry: ${error}`),
        )
        .finally(() => this.scheduleNext());
    }, this.intervalMs);
  }

  async reconcile(): Promise<number> {
    const stale = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'PENDING_PAYMENT'),
          lt(bookings.createdAt, new Date(Date.now() - this.graceMs)),
        ),
      )
      .orderBy(asc(bookings.createdAt))
      .limit(BATCH_SIZE);

    let settled = 0;
    for (const { id } of stale) {
      // No lock is held during these provider calls. If two reconcilers (or
      // a late checkout) settle the same booking, the conditional UPDATE in
      // settlePayment lets only the first one through.
      const outcome = await this.payments.resolve(id);
      if (await this.bookingsService.settlePayment(id, outcome)) {
        settled++;
        this.logger.log(`Booking ${id} settled as ${outcome.status}`);
      }
    }
    return settled;
  }
}
