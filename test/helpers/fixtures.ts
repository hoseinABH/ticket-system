import request from 'supertest';
import { flights } from '../../src/core/database/schema';
import type { TestContext } from './test-app';

export async function registerAndLogin(ctx: TestContext, email: string) {
  const credentials = { email, password: 'secret123' };
  const http = () => request(ctx.app.getHttpServer());
  await http().post('/auth/register').send(credentials).expect(201);
  const login = await http().post('/auth/login').send(credentials).expect(201);
  return login.body.accessToken as string;
}

export async function createFlight(
  ctx: TestContext,
  flightNumber: string,
  availableSeats: number,
) {
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

// Quote + checkout in one step; returns the created booking
export async function book(
  ctx: TestContext,
  token: string,
  flightId: string,
  seatCount: number,
) {
  const quote = await request(ctx.app.getHttpServer())
    .post('/flights/quote')
    .auth(token, { type: 'bearer' })
    .send({ flightId, seatCount })
    .expect(201);
  const checkout = await request(ctx.app.getHttpServer())
    .post('/bookings/checkout')
    .auth(token, { type: 'bearer' })
    .send({ quoteToken: quote.body.quoteToken })
    .expect(201);
  return checkout.body as { id: string; pnr: string; status: string };
}
