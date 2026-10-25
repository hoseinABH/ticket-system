import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../src/core/database/schema';
import type { DrizzleDB } from '../../src/core/database/database.module';
import { FlightsService } from '../../src/modules/flights/flights.service';
import { startMigratedPostgres } from '../helpers/test-app';

// Query-plan lab: loads a realistically sized dataset and asserts that the
// app's real queries use the indexes they were designed around. A rewrite
// that silently falls back to scanning whole tables fails here, long before
// it shows up as latency in production.

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Heap Fetches'?: number;
  Plans?: PlanNode[];
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

describe('Query-plan lab (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: DrizzleDB;
  let flightsService: FlightsService;

  // 5,000 flights on 50 routes, some already departed; 30 seats each
  // (150,000 seats); 1 in 3 seats booked by one of 1,000 users
  beforeAll(async () => {
    container = await startMigratedPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema });
    // Search never touches Redis, so the service needs no client here
    flightsService = new FlightsService(db, undefined as never);

    await pool.query(`
      INSERT INTO flights.flights (flight_number, origin, destination, departure_time, base_price)
      SELECT 'PL-' || n,
             (ARRAY['THR','IST','DXB','FRA','CDG','LHR','AMS','DOH','MUC','VIE'])[1 + n % 10],
             (ARRAY['JFK','SFO','NRT','SIN','SYD'])[1 + (n / 10) % 5],
             now() - interval '60 days' + (n % 365) * interval '1 day',
             100 + n % 400
      FROM generate_series(1, 5000) n`);
    await pool.query(`
      INSERT INTO flights.seats (flight_id, seat_number)
      SELECT f.id, (s / 6 + 1)::text || chr(65 + s % 6)
      FROM flights.flights f CROSS JOIN generate_series(0, 29) s`);
    // Book seats A and B of every row (a third of all seats), one booking
    // per seat. The CTE is evaluated once, so both writes see the same IDs.
    await pool.query(`
      WITH pick AS (
        SELECT s.id AS seat_id, s.flight_id, gen_random_uuid() AS booking_id,
               row_number() OVER () AS n
        FROM flights.seats s WHERE s.seat_number ~ '[AB]$'
      ), inserted AS (
        INSERT INTO bookings.bookings
          (id, user_id, flight_id, pnr, seat_count, total_locked_price, status, created_at)
        SELECT booking_id, md5('user' || (n % 1000))::uuid, flight_id,
               upper(lpad(to_hex(n), 8, '0')), 1, 100, 'CONFIRMED',
               now() - (n % 500) * interval '1 hour'
        FROM pick
      )
      UPDATE flights.seats s SET booking_id = p.booking_id
      FROM pick p WHERE s.id = p.seat_id`);
    // Statistics for the planner, and a fresh visibility map so index-only
    // scans can skip the table entirely (autovacuum does this in production)
    await pool.query('VACUUM ANALYZE');
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function explain(query: {
    toSQL(): { sql: string; params: unknown[] };
  }) {
    const { sql, params } = query.toSQL();
    const { rows } = await pool.query(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
      params,
    );
    return flatten(rows[0]['QUERY PLAN'][0].Plan as PlanNode);
  }

  const scansOf = (nodes: PlanNode[], relation: string) =>
    nodes.filter((n) => n['Relation Name'] === relation);

  it('seeds the dataset it claims to', async () => {
    const { rows } = await pool.query(`
      SELECT (SELECT count(*) FROM flights.flights)::int AS flights,
             (SELECT count(*) FROM flights.seats)::int AS seats,
             (SELECT count(*) FROM flights.seats WHERE booking_id IS NOT NULL)::int AS booked`);
    expect(rows[0].flights).toBe(5000);
    expect(rows[0].seats).toBe(150_000);
    expect(rows[0].booked).toBe(50_000);
  });

  describe('flight search', () => {
    it('finds flights through the route index and counts seats index-only', async () => {
      const plan = await explain(
        flightsService.searchFlightsQuery('THR', 'JFK'),
      );

      const flightScans = scansOf(plan, 'flights');
      expect(flightScans.map((n) => n['Node Type'])).not.toContain('Seq Scan');

      const seatScans = scansOf(plan, 'seats');
      expect(seatScans).toHaveLength(1);
      expect(seatScans[0]).toMatchObject({
        'Node Type': 'Index Only Scan',
        'Index Name': 'seats_free_by_flight_idx',
        // Every answer came from the index; the table was never read
        'Heap Fetches': 0,
      });

      const routeIndex = plan.find(
        (n) => n['Index Name'] === 'flights_route_departure_idx',
      );
      expect(routeIndex).toBeDefined();
    });

    it('returns only future flights with free seats, earliest first', async () => {
      const results = await flightsService.searchFlights('thr', 'jfk');

      expect(results.length).toBeGreaterThan(0);
      const now = Date.now();
      for (const flight of results) {
        expect(flight.departureTime.getTime()).toBeGreaterThan(now);
        expect(flight.availableSeats).toBeGreaterThan(0);
      }
      const times = results.map((f) => f.departureTime.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });
  });

  describe('my bookings', () => {
    it("reads a user's bookings through the user index", async () => {
      const user = (await pool.query(`SELECT md5('user42')::uuid AS id`))
        .rows[0].id as string;
      // Same query shape as BookingsService.getUserBookings
      const query = db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.userId, user))
        .orderBy(desc(schema.bookings.createdAt));

      const plan = await explain(query);

      expect(
        scansOf(plan, 'bookings').map((n) => n['Node Type']),
      ).not.toContain('Seq Scan');
      expect(
        plan.some((n) => n['Index Name'] === 'bookings_user_id_created_at_idx'),
      ).toBe(true);
    });
  });
});
