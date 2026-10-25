import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import {
  RabbitMQContainer,
  StartedRabbitMQContainer,
} from '@testcontainers/rabbitmq';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { App } from 'supertest/types.js';
import type { DrizzleDB } from '../../src/core/database/database.module';

export interface TestContext {
  // Replaced by restart(), so always read them through the context
  app: INestApplication<App>;
  db: DrizzleDB;
  // Stops this app instance and boots a fresh one (new module graph, new
  // connections, new background workers) against the same Postgres, Redis
  // and RabbitMQ, like a process restart. `env` overrides variables for the
  // new instance only.
  restart: (env?: Record<string, string>) => Promise<void>;
  close: () => Promise<void>;
}

// Boots the full application against throwaway Postgres, Redis and RabbitMQ
// containers, with the schema built by the same migrations production runs.
export async function createTestApp(
  env: Record<string, string> = {},
): Promise<TestContext> {
  const [postgres, redis, rabbit] = await Promise.all([
    startMigratedPostgres(),
    new RedisContainer('redis:7-alpine').start(),
    new RabbitMQContainer('rabbitmq:3-alpine').start(),
  ]);

  const baseEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    RABBITMQ_URL: rabbit.getAmqpUrl(),
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
    // Publish events quickly so tests do not wait long for them
    OUTBOX_POLL_INTERVAL_MS: '50',
  };

  const ctx = {
    restart: async (overrides: Record<string, string> = {}) => {
      await ctx.app.close();
      Object.assign(ctx, await boot({ ...baseEnv, ...overrides }));
    },
    close: async () => {
      await ctx.app.close();
      await stopContainers(postgres, redis, rabbit);
    },
    ...(await boot({ ...baseEnv, ...env })),
  };
  return ctx;
}

async function boot(env: Record<string, string>) {
  Object.assign(process.env, env);

  // ConfigModule.forRoot() reads and validates the environment when
  // AppModule is first evaluated, so import a fresh copy of the module graph
  vi.resetModules();
  const { AppModule } = await import('../../src/app.module');
  // Injection tokens are Symbols: take them from the same fresh module graph
  const { DRIZZLE } = await import('../../src/core/database/database.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  // Listen on a random free port so concurrent supertest calls share one
  // server instead of each binding its own
  await app.listen(0);
  return { app, db: app.get<DrizzleDB>(DRIZZLE) };
}

// A throwaway Postgres with every migration applied
export async function startMigratedPostgres(): Promise<StartedPostgreSqlContainer> {
  const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: postgres.getConnectionUri() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
  return postgres;
}

async function stopContainers(
  postgres: StartedPostgreSqlContainer,
  redis: StartedRedisContainer,
  rabbit: StartedRabbitMQContainer,
) {
  await Promise.all([postgres.stop(), redis.stop(), rabbit.stop()]);
}
