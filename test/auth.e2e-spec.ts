import request from 'supertest';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const http = () => request(ctx.app.getHttpServer());

  it('rejects invalid input with the standard error shape', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ email: 'not-an-email', password: '123' })
      .expect(400);

    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'BAD_REQUEST',
      path: '/auth/register',
    });
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringMatching(/email/)]),
    );
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns 409, never 500, when the same email registers concurrently', async () => {
    // The service's "does this email exist?" check races: several requests
    // can pass it before any insert lands. The UNIQUE constraint is the real
    // guard, and the exception filter maps its violation (23505) to 409.
    const credentials = { email: 'race@example.com', password: 'secret123' };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        http().post('/auth/register').send(credentials),
      ),
    );

    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
  });

  it('revokes a token on logout', async () => {
    const credentials = { email: 'logout@example.com', password: 'secret123' };
    await http().post('/auth/register').send(credentials).expect(201);
    const login = await http()
      .post('/auth/login')
      .send(credentials)
      .expect(201);
    const token = login.body.accessToken as string;

    await http()
      .get('/bookings/my-bookings')
      .auth(token, { type: 'bearer' })
      .expect(200);

    await http()
      .post('/auth/logout')
      .auth(token, { type: 'bearer' })
      .expect(201);

    await http()
      .get('/bookings/my-bookings')
      .auth(token, { type: 'bearer' })
      .expect(401);
  });
});
