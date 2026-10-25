import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { App } from 'supertest/types.js';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../src/core/database/database.module';

export interface TestContext {
  app: INestApplication<App>;
  db: DrizzleDB;
  close: () => Promise<void>;
}

// Boots the full application against throwaway Postgres and Redis containers,
// with the schema built by the same migrations production would run.
export async function createTestApp(): Promise<TestContext> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  await runMigrations(postgres);

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = postgres.getConnectionUri();
  process.env.REDIS_URL = redis.getConnectionUrl();
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';

  // Imported only after the env is set, because ConfigModule.forRoot()
  // validates the environment when AppModule is first evaluated
  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  // Listen on a random free port so concurrent supertest calls share one
  // server instead of each binding its own
  await app.listen(0);

  return {
    app,
    db: app.get<DrizzleDB>(DRIZZLE),
    close: async () => {
      await app.close();
      await stopContainers(postgres, redis);
    },
  };
}

async function runMigrations(postgres: StartedPostgreSqlContainer) {
  const pool = new Pool({ connectionString: postgres.getConnectionUri() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}

async function stopContainers(
  postgres: StartedPostgreSqlContainer,
  redis: StartedRedisContainer,
) {
  await Promise.all([postgres.stop(), redis.stop()]);
}
