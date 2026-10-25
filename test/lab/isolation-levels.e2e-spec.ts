import { randomBytes } from 'crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { startMigratedPostgres } from '../helpers/test-app';

// Isolation-level lab: each test scripts two concurrent transactions (T1, T2)
// step by step on separate connections, so every interleaving is explicit
// and deterministic. Read them top to bottom like a sequence diagram.
//
// Postgres implements three distinct levels:
//   READ COMMITTED (default)  every statement sees a fresh snapshot
//   REPEATABLE READ           the whole transaction sees one snapshot
//   SERIALIZABLE              REPEATABLE READ + detection of any interleaving
//                             that no serial order could have produced

type Level =
  'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

const SERIALIZATION_FAILURE = '40001';

describe('Isolation-level lab (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  const open: PoolClient[] = [];

  beforeAll(async () => {
    container = await startMigratedPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
  });

  afterEach(async () => {
    // Roll back anything a failed test left open, then return the clients
    for (const client of open.splice(0)) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function begin(level: Level) {
    const client = await pool.connect();
    open.push(client);
    await client.query(`BEGIN ISOLATION LEVEL ${level}`);
    return client;
  }

  async function value<T>(
    client: Pool | PoolClient,
    text: string,
    params: unknown[] = [],
  ): Promise<T> {
    const { rows } = await client.query(text, params);
    return Object.values(rows[0])[0] as T;
  }

  async function createFlight(price = '100.00', capacity = 6) {
    const flightNumber = `LAB-${randomBytes(3).toString('hex')}`;
    const id = await value<string>(
      pool,
      `INSERT INTO flights.flights
         (flight_number, origin, destination, departure_time, base_price)
       VALUES ($1, 'THR', 'IST', now() + interval '1 day', $2) RETURNING id`,
      [flightNumber, price],
    );
    await pool.query(
      `INSERT INTO flights.seats (flight_id, seat_number)
       SELECT $1, '1' || chr(64 + n) FROM generate_series(1, $2) AS n`,
      [id, capacity],
    );
    return id;
  }

  const price = (c: Pool | PoolClient, flightId: string) =>
    value<string>(c, 'SELECT base_price FROM flights.flights WHERE id = $1', [
      flightId,
    ]);

  const freeSeats = (c: Pool | PoolClient, flightId: string) =>
    value<number>(
      c,
      `SELECT count(*)::int FROM flights.seats
       WHERE flight_id = $1 AND booking_id IS NULL`,
      [flightId],
    );

  describe('dirty read: seeing uncommitted data', () => {
    it('never happens in Postgres, even at READ UNCOMMITTED', async () => {
      const flight = await createFlight('100.00');

      const t1 = await begin('READ COMMITTED');
      await t1.query(
        `UPDATE flights.flights SET base_price = 999 WHERE id = $1`,
        [flight],
      );

      // Postgres silently runs READ UNCOMMITTED as READ COMMITTED
      const t2 = await begin('READ UNCOMMITTED');
      expect(await price(t2, flight)).toBe('100.00');

      await t1.query('ROLLBACK');
    });
  });

  describe('non-repeatable read: the same row read twice differs', () => {
    async function scenario(level: Level) {
      const flight = await createFlight('100.00');
      const t1 = await begin(level);
      const first = await price(t1, flight);

      // Another transaction commits a change in between
      await pool.query(
        `UPDATE flights.flights SET base_price = 150 WHERE id = $1`,
        [flight],
      );

      const second = await price(t1, flight);
      await t1.query('COMMIT');
      return [first, second];
    }

    it('happens under READ COMMITTED', async () => {
      expect(await scenario('READ COMMITTED')).toEqual(['100.00', '150.00']);
    });

    it('is prevented by REPEATABLE READ (one snapshot per transaction)', async () => {
      expect(await scenario('REPEATABLE READ')).toEqual(['100.00', '100.00']);
    });
  });

  describe('phantom read: a re-run query returns a different set of rows', () => {
    async function scenario(level: Level) {
      const flight = await createFlight('100.00', 6);
      const t1 = await begin(level);
      const before = await freeSeats(t1, flight);

      // Someone books a seat and commits
      await pool.query(
        `UPDATE flights.seats SET booking_id = gen_random_uuid()
         WHERE flight_id = $1 AND seat_number = '1A'`,
        [flight],
      );

      const after = await freeSeats(t1, flight);
      await t1.query('COMMIT');
      return [before, after];
    }

    it('happens under READ COMMITTED', async () => {
      expect(await scenario('READ COMMITTED')).toEqual([6, 5]);
    });

    it('is prevented by REPEATABLE READ (stricter than the SQL standard requires)', async () => {
      expect(await scenario('REPEATABLE READ')).toEqual([6, 6]);
    });
  });

  describe('lost update: read-modify-write in application code', () => {
    // Two admins each raise the price by 10 the naive way: read the price,
    // add 10 in JavaScript, write the result back. Expected final: 120.
    async function raiseBy10(client: PoolClient, flight: string, read: string) {
      const raised = (Number(read) + 10).toFixed(2);
      await client.query(
        `UPDATE flights.flights SET base_price = $2 WHERE id = $1`,
        [flight, raised],
      );
    }

    it('silently loses a write under READ COMMITTED', async () => {
      const flight = await createFlight('100.00');
      const t1 = await begin('READ COMMITTED');
      const t2 = await begin('READ COMMITTED');

      const t1Read = await price(t1, flight); // 100
      const t2Read = await price(t2, flight); // 100
      await raiseBy10(t1, flight, t1Read); // writes 110
      await t1.query('COMMIT');
      await raiseBy10(t2, flight, t2Read); // also writes 110
      await t2.query('COMMIT');

      expect(await price(pool, flight)).toBe('110.00'); // one raise lost
    });

    it('is detected under REPEATABLE READ: the second writer must retry', async () => {
      const flight = await createFlight('100.00');
      const t1 = await begin('REPEATABLE READ');
      const t2 = await begin('REPEATABLE READ');

      const t1Read = await price(t1, flight);
      const t2Read = await price(t2, flight);
      await raiseBy10(t1, flight, t1Read);
      await t1.query('COMMIT');

      // T2's snapshot predates T1's commit, so writing that row would base
      // the change on stale data: Postgres refuses
      await expect(raiseBy10(t2, flight, t2Read)).rejects.toMatchObject({
        code: SERIALIZATION_FAILURE,
      });
      expect(await price(pool, flight)).toBe('110.00');
    });

    it('cannot happen with an atomic UPDATE, even under READ COMMITTED', async () => {
      const flight = await createFlight('100.00');
      const t1 = await begin('READ COMMITTED');
      const t2 = await begin('READ COMMITTED');

      // The database does the read-modify-write on the latest committed row.
      // T2's UPDATE waits for T1's row lock, then re-reads the new value.
      const raise = `UPDATE flights.flights SET base_price = base_price + 10 WHERE id = $1`;
      await t1.query(raise, [flight]);
      const t2Raise = t2.query(raise, [flight]); // blocks on T1's lock
      await t1.query('COMMIT');
      await t2Raise;
      await t2.query('COMMIT');

      expect(await price(pool, flight)).toBe('120.00');
    });
  });

  describe('write skew: two transactions each keep a rule that together they break', () => {
    // Business rule: at most 2 active bookings per user per flight. Each
    // transaction counts, sees room, and inserts. Neither writes a row the
    // other wrote, so no row lock or version check can notice the conflict,
    // and no UNIQUE constraint can express "at most 2".
    const LIMIT = 2;
    const user = '00000000-0000-0000-0000-00000000000a';

    async function insertBooking(client: Pool | PoolClient, flight: string) {
      await client.query(
        `INSERT INTO bookings.bookings
           (user_id, flight_id, pnr, seat_count, total_locked_price, status)
         VALUES ($1, $2, $3, 1, 100, 'CONFIRMED')`,
        [user, flight, randomBytes(3).toString('hex').toUpperCase()],
      );
    }

    const activeBookings = (c: Pool | PoolClient, flight: string) =>
      value<number>(
        c,
        `SELECT count(*)::int FROM bookings.bookings
         WHERE user_id = $1 AND flight_id = $2 AND status = 'CONFIRMED'`,
        [user, flight],
      );

    it('breaks the rule under REPEATABLE READ', async () => {
      const flight = await createFlight();
      await insertBooking(pool, flight); // the user already has 1

      const t1 = await begin('REPEATABLE READ');
      const t2 = await begin('REPEATABLE READ');
      expect(await activeBookings(t1, flight)).toBe(1); // room for one more
      expect(await activeBookings(t2, flight)).toBe(1); // room for one more
      await insertBooking(t1, flight);
      await insertBooking(t2, flight);
      await t1.query('COMMIT');
      await t2.query('COMMIT');

      expect(await activeBookings(pool, flight)).toBe(3); // limit is 2
    });

    it('is detected under SERIALIZABLE: one transaction is aborted', async () => {
      const flight = await createFlight();
      await insertBooking(pool, flight);

      const t1 = await begin('SERIALIZABLE');
      const t2 = await begin('SERIALIZABLE');
      expect(await activeBookings(t1, flight)).toBe(1);
      expect(await activeBookings(t2, flight)).toBe(1);
      await insertBooking(t1, flight);
      await t1.query('COMMIT');

      // No serial order of T1 and T2 could produce this outcome, so
      // Postgres's Serializable Snapshot Isolation (SSI) aborts T2
      const t2Finish = (async () => {
        await insertBooking(t2, flight);
        await t2.query('COMMIT');
      })();
      await expect(t2Finish).rejects.toMatchObject({
        code: SERIALIZATION_FAILURE,
      });
      expect(await activeBookings(pool, flight)).toBe(LIMIT);
    });

    it('stays correct when serialization failures are retried', async () => {
      // SERIALIZABLE only works with a retry loop: an aborted transaction
      // must be re-run from the start, re-reading everything it decided on
      const flight = await createFlight();
      await insertBooking(pool, flight);

      // Both first attempts read before either writes, forcing the conflict
      let arrived = 0;
      let attempts = 0;
      let release!: () => void;
      const bothHaveRead = new Promise<void>((r) => (release = r));

      async function bookIfUnderLimit(attempt: number) {
        attempts++;
        const client = await pool.connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          const count = await activeBookings(client, flight);
          if (attempt === 1 && ++arrived === 2) release();
          if (attempt === 1) await bothHaveRead;
          if (count >= LIMIT) {
            await client.query('ROLLBACK');
            return 'limit reached';
          }
          await insertBooking(client, flight);
          await client.query('COMMIT');
          return 'booked';
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }

      async function withRetry(maxAttempts = 5) {
        for (let attempt = 1; ; attempt++) {
          try {
            return await bookIfUnderLimit(attempt);
          } catch (error) {
            const retryable =
              (error as { code?: string }).code === SERIALIZATION_FAILURE;
            if (!retryable || attempt === maxAttempts) throw error;
          }
        }
      }

      const outcomes = await Promise.all([withRetry(), withRetry()]);

      expect([...outcomes].sort()).toEqual(['booked', 'limit reached']);
      // 2 first attempts + 1 retry of the aborted one: the retry path ran
      expect(attempts).toBe(3);
      expect(await activeBookings(pool, flight)).toBe(LIMIT);
    });
  });
});
