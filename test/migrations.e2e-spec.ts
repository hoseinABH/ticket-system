import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const MIGRATIONS = './drizzle';

// A copy of the migrations folder whose journal stops at `lastTag`, so the
// database can be put into the exact state an older release left it in
function migrationsUpTo(lastTag: string) {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const last = journal.entries.findIndex(
    (e: { tag: string }) => e.tag === lastTag,
  );
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('Migration 0003 seat inventory backfill (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('creates seats from the old counter and assigns them to bookings', async () => {
    const before = migrationsUpTo('0002_booking_lifecycle');
    try {
      await migrate(drizzle(pool), { migrationsFolder: before });
    } finally {
      rmSync(before, { recursive: true });
    }

    // Data as the previous release stored it: a seat counter per flight
    const { rows } = await pool.query<{ id: string; flight_number: string }>(`
      INSERT INTO flights.flights
        (flight_number, origin, destination, departure_time, available_seats, base_price)
      VALUES
        ('OLD-1', 'THR', 'IST', now() + interval '1 day', 4, 100),
        ('OLD-2', 'THR', 'IST', now() + interval '1 day', 0, 100)
      RETURNING id, flight_number`);
    const old1 = rows.find((r) => r.flight_number === 'OLD-1')!.id;
    const user = '00000000-0000-0000-0000-000000000001';
    await pool.query(
      `INSERT INTO bookings.bookings
        (id, user_id, flight_id, pnr, seat_count, total_locked_price, status, created_at, cancelled_at)
      VALUES
        ('00000000-0000-0000-0000-0000000000b1', $1, $2, 'AAA111', 2, 200, 'CONFIRMED', now() - interval '2 hours', NULL),
        ('00000000-0000-0000-0000-0000000000b2', $1, $2, 'BBB222', 1, 100, 'CONFIRMED', now() - interval '1 hour', NULL),
        ('00000000-0000-0000-0000-0000000000b3', $1, $2, 'CCC333', 3, 300, 'CANCELLED', now() - interval '3 hours', now())`,
      [user, old1],
    );

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });

    const seats = await pool.query<{
      flight_number: string;
      seat_number: string;
      booking_id: string | null;
    }>(`
      SELECT f.flight_number, s.seat_number, s.booking_id
      FROM flights.seats s JOIN flights.flights f ON f.id = s.flight_id
      ORDER BY f.flight_number, length(s.seat_number), s.seat_number`);

    // Capacity = 4 still available + 3 held by confirmed bookings. The
    // cancelled booking holds nothing. Oldest booking gets the front seats.
    expect(seats.rows).toEqual([
      {
        flight_number: 'OLD-1',
        seat_number: '1A',
        booking_id: '00000000-0000-0000-0000-0000000000b1',
      },
      {
        flight_number: 'OLD-1',
        seat_number: '1B',
        booking_id: '00000000-0000-0000-0000-0000000000b1',
      },
      {
        flight_number: 'OLD-1',
        seat_number: '1C',
        booking_id: '00000000-0000-0000-0000-0000000000b2',
      },
      { flight_number: 'OLD-1', seat_number: '1D', booking_id: null },
      { flight_number: 'OLD-1', seat_number: '1E', booking_id: null },
      { flight_number: 'OLD-1', seat_number: '1F', booking_id: null },
      { flight_number: 'OLD-1', seat_number: '2A', booking_id: null },
    ]);

    const columns = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'flights' AND table_name = 'flights'
        AND column_name = 'available_seats'`);
    expect(columns.rowCount).toBe(0);
  });
});
