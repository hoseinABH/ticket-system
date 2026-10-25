import { validateEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://root:secret@localhost:5432/ticket_system',
  JWT_SECRET: 'a'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults and coerces numbers', () => {
    const env = validateEnv({ ...validEnv, PORT: '4000' });

    expect(env.PORT).toBe(4000);
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.JWT_EXPIRES_IN_SECONDS).toBe(3600);
  });

  it('parses retry delays into a list of milliseconds', () => {
    expect(validateEnv(validEnv).MESSAGE_RETRY_DELAYS_MS).toEqual([
      1000, 5000, 30000,
    ]);
    expect(
      validateEnv({ ...validEnv, MESSAGE_RETRY_DELAYS_MS: '50,100' })
        .MESSAGE_RETRY_DELAYS_MS,
    ).toEqual([50, 100]);
    expect(() =>
      validateEnv({ ...validEnv, MESSAGE_RETRY_DELAYS_MS: '50,soon' }),
    ).toThrow(/MESSAGE_RETRY_DELAYS_MS/);
  });

  it('rejects a missing JWT_SECRET', () => {
    expect(() => validateEnv({ DATABASE_URL: validEnv.DATABASE_URL })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => validateEnv({ ...validEnv, JWT_SECRET: 'short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() =>
      validateEnv({ ...validEnv, DATABASE_URL: 'not-a-url' }),
    ).toThrow(/DATABASE_URL/);
  });
});
