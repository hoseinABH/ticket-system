import { Injectable } from '@nestjs/common';
import type { DrizzleDB } from '../database/database.module';
import { outboxMessages } from '../database/schema';

@Injectable()
export class OutboxService {
  // Must be called with the transaction that makes the business change, so
  // the event commits (or rolls back) together with it
  async enqueue(tx: DrizzleDB, type: string, payload: object) {
    await tx.insert(outboxMessages).values({ type, payload });
  }
}
