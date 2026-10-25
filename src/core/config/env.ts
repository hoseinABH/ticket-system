import { z } from 'zod';

// Single source of truth for every environment variable the app reads.
// Validated once at startup: a missing or malformed value stops the boot
// instead of surfacing later as a confusing runtime error.
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  RABBITMQ_URL: z.url().default('amqp://localhost:5672'),
  // How often the outbox relay looks for unpublished events
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  // Backoff before each retry of a failed message, e.g. "1000,5000,30000":
  // three retries, then the dead-letter queue
  MESSAGE_RETRY_DELAYS_MS: z
    .string()
    .default('1000,5000,30000')
    .transform((value) => value.split(',').map(Number))
    .pipe(z.array(z.number().int().positive()).min(1)),
  // How long checkout waits for the payment provider before treating the
  // outcome as unknown and leaving it to the reconciler
  PAYMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // How often the reconciler settles bookings stuck in PENDING_PAYMENT
  PAYMENT_RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10_000),
  // HS256 needs a key at least as long as its 256-bit output to be safe
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(3600),
  // Optional: leaving these unset disables @nestjs/observe telemetry
  OBSERVE_APP_KEY: z.string().optional(),
  OBSERVE_APP_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
