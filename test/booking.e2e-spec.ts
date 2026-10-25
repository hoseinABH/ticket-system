import request from 'supertest';
import { eq } from 'drizzle-orm';
import { bookings, flights } from '../src/core/database/schema';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Booking checkout (e2e)', () => {
  let ctx: TestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    const credentials = { email: 'buyer@example.com', password: 'secret123' };
    await http().post('/auth/register').send(credentials).expect(201);
    const login = await http()
      .post('/auth/login')
      .send(credentials)
      .expect(201);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const http = () => request(ctx.app.getHttpServer());

  async function createFlight(flightNumber: string, availableSeats: number) {
    const [flight] = await ctx.db
      .insert(flights)
      .values({
        flightNumber,
        origin: 'THR',
        destination: 'IST',
        departureTime: new Date(Date.now() + 86_400_000),
        availableSeats,
        basePrice: '100.00',
      })
      .returning();
    return flight;
  }

  async function createQuote(flightId: string, seatCount: number) {
    const res = await http()
      .post('/flights/quote')
      .auth(token, { type: 'bearer' })
      .send({ flightId, seatCount })
      .expect(201);
    return res.body.quoteToken as string;
  }

  function checkout(quoteToken: string) {
    return http()
      .post('/bookings/checkout')
      .auth(token, { type: 'bearer' })
      .send({ quoteToken });
  }

  it('never oversells: 20 concurrent checkouts for 10 seats', async () => {
    const flight = await createFlight('TS-001', 10);

    // Quotes only check availability at quote time, so all 20 succeed
    const quoteTokens = await Promise.all(
      Array.from({ length: 20 }, () => createQuote(flight.id, 1)),
    );

    // Fire every checkout at once: SELECT ... FOR UPDATE must serialize them
    const responses = await Promise.all(quoteTokens.map(checkout));

    const succeeded = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 400);
    expect(succeeded).toHaveLength(10);
    expect(rejected).toHaveLength(10);

    const [after] = await ctx.db
      .select()
      .from(flights)
      .where(eq(flights.id, flight.id));
    expect(after.availableSeats).toBe(0);

    const flightBookings = await ctx.db
      .select()
      .from(bookings)
      .where(eq(bookings.flightId, flight.id));
    expect(flightBookings).toHaveLength(10);
  });

  it('rejects replaying a quote token', async () => {
    const flight = await createFlight('TS-002', 5);
    const quoteToken = await createQuote(flight.id, 2);

    await checkout(quoteToken).expect(201);
    const replay = await checkout(quoteToken).expect(400);

    expect(replay.body.message).toMatch(/invalid, expired, or already used/);

    const [after] = await ctx.db
      .select()
      .from(flights)
      .where(eq(flights.id, flight.id));
    expect(after.availableSeats).toBe(3);
  });

  it('requires authentication', async () => {
    await http()
      .post('/bookings/checkout')
      .send({ quoteToken: 'quote_x' })
      .expect(401);
  });
});
