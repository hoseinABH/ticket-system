import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { sql } from 'drizzle-orm';

export const DRIZZLE = Symbol('DRIZZLE_CONNECTION');
export type DrizzleDB = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule implements OnModuleInit {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async onModuleInit() {
    await this.db.execute(sql`CREATE SCHEMA IF NOT EXISTS auth;`);
    await this.db.execute(sql`CREATE SCHEMA IF NOT EXISTS flights;`);
    await this.db.execute(sql`CREATE SCHEMA IF NOT EXISTS bookings;`);
  }
}
