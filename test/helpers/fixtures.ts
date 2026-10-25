import request from 'supertest';
import { and, count, eq, isNull } from 'drizzle-orm';
import { flights, seats } from '../../src/core/database/schema';
import { generateSeatNumbers } from '../../src/modules/flights/domain/seat-layout';
import type { TestContext } from './test-app';

export async function registerAndLogin(ctx: TestContext, email: string) {
  const credentials = { email, password: 'secret123' };
  const http = () => request(ctx.app.getHttpServer());
  await http().post('/auth/register').send(credentials).expect(201);
  const login = await http().post('/auth/login').send(credentials).expect(201);
  return login.body.accessToken as string;
}

// Inserts a flight departing tomorrow with seats 1A, 1B, ... up to capacity
export async function createFlight(
  ctx: TestContext,
  flightNumber: string,
  capacity: number,
) {
  return ctx.db.transaction(async (tx) => {
    const [flight] = await tx
      .insert(flights)
      .values({
        flightNumber,
        origin: 'THR',
        destination: 'IST',
        departureTime: new Date(Date.now() + 86_400_000),
        basePrice: '100.00',
      })
      .returning();
    await tx.insert(seats).values(
      generateSeatNumbers(capacity).map((seatNumber) => ({
        flightId: flight.id,
        seatNumber,
      })),
    );
    return flight;
  });
}

export async function freeSeatCount(ctx: TestContext, flightId: string) {
  const [{ value }] = await ctx.db
    .select({ value: count() })
    .from(seats)
    .where(and(eq(seats.flightId, flightId), isNull(seats.bookingId)));
  return value;
}

export async function createQuote(
  ctx: TestContext,
  token: string,
  flightId: string,
  seatNumbers: string[],
) {
  const res = await request(ctx.app.getHttpServer())
    .post('/flights/quote')
    .auth(token, { type: 'bearer' })
    .send({ flightId, seatNumbers })
    .expect(201);
  return res.body.quoteToken as string;
}

export function checkout(ctx: TestContext, token: string, quoteToken: string) {
  return request(ctx.app.getHttpServer())
    .post('/bookings/checkout')
    .auth(token, { type: 'bearer' })
    .send({ quoteToken });
}

// Quote + checkout in one step; returns the created booking
export async function book(
  ctx: TestContext,
  token: string,
  flightId: string,
  seatNumbers: string[],
) {
  const quoteToken = await createQuote(ctx, token, flightId, seatNumbers);
  const res = await checkout(ctx, token, quoteToken).expect(201);
  return res.body as {
    id: string;
    pnr: string;
    status: string;
    seatNumbers: string[];
  };
}
