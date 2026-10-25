import request from 'supertest';
import { createFlight, registerAndLogin } from './helpers/fixtures';
import { createTestApp, type TestContext } from './helpers/test-app';

describe('Flight editing with optimistic locking (e2e)', () => {
  let ctx: TestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    token = await registerAndLogin(ctx, 'admin@example.com');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const http = () => request(ctx.app.getHttpServer());

  function getFlight(id: string) {
    return http().get(`/flights/${id}`).expect(200);
  }

  function patchFlight(id: string, ifMatch: string | undefined, body: object) {
    const req = http()
      .patch(`/flights/${id}`)
      .auth(token, { type: 'bearer' })
      .send(body);
    return ifMatch === undefined ? req : req.set('If-Match', ifMatch);
  }

  it('returns the row version as an ETag', async () => {
    const flight = await createFlight(ctx, 'ED-001', 6);

    const res = await getFlight(flight.id);

    expect(res.headers.etag).toBe('"1"');
    expect(res.body.version).toBe(1);
  });

  it('applies an edit made against the current version', async () => {
    const flight = await createFlight(ctx, 'ED-002', 6);

    const res = await patchFlight(flight.id, '"1"', {
      basePrice: '149.50',
    }).expect(200);

    expect(res.body.basePrice).toBe('149.50');
    expect(res.headers.etag).toBe('"2"');
  });

  it('prevents the lost update: the second editor must reload', async () => {
    const flight = await createFlight(ctx, 'ED-003', 6);

    // Alice and Bob both open the edit form and see version 1
    const aliceSaw = (await getFlight(flight.id)).headers.etag;
    const bobSaw = (await getFlight(flight.id)).headers.etag;

    // Alice changes the price and saves first
    await patchFlight(flight.id, aliceSaw, { basePrice: '120.00' }).expect(200);

    // Bob, still looking at version 1, reschedules. Without the version
    // check this write would silently succeed on top of Alice's change,
    // and Bob would never learn the price had moved under him.
    const bobAttempt = await patchFlight(flight.id, bobSaw, {
      departureTime: '2030-01-01T10:00:00Z',
    }).expect(412);
    expect(bobAttempt.body.message).toMatch(/now at version 2/);

    // Bob reloads, sees Alice's price, and re-applies his change
    const reloaded = await getFlight(flight.id);
    expect(reloaded.body.basePrice).toBe('120.00');
    await patchFlight(flight.id, reloaded.headers.etag, {
      departureTime: '2030-01-01T10:00:00Z',
    }).expect(200);

    const final = await getFlight(flight.id);
    expect(final.body).toMatchObject({
      basePrice: '120.00',
      departureTime: '2030-01-01T10:00:00.000Z',
      version: 3,
    });
  });

  it('lets exactly one of many concurrent editors win', async () => {
    const flight = await createFlight(ctx, 'ED-004', 6);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        patchFlight(flight.id, '"1"', { basePrice: `${100 + i}.00` }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 412)).toHaveLength(9);
    expect((await getFlight(flight.id)).body.version).toBe(2);
  });

  it('requires If-Match (428) and rejects malformed tags (412)', async () => {
    const flight = await createFlight(ctx, 'ED-005', 6);

    await patchFlight(flight.id, undefined, { basePrice: '1.00' }).expect(428);
    await patchFlight(flight.id, 'W/"1"', { basePrice: '1.00' }).expect(412);
  });

  it('validates the edit itself', async () => {
    const flight = await createFlight(ctx, 'ED-006', 6);

    await patchFlight(flight.id, '"1"', {}).expect(400);
    await patchFlight(flight.id, '"1"', { basePrice: '0' }).expect(400);
    await patchFlight(flight.id, '"1"', { basePrice: '9.999' }).expect(400);
    await patchFlight(flight.id, '"1"', { departureTime: 'soon' }).expect(400);
    await patchFlight(flight.id, '"1"', { version: 99 }).expect(400);
  });

  it('returns 404 for an unknown flight and requires auth', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    await patchFlight(missing, '"1"', { basePrice: '1.00' }).expect(404);
    await http()
      .patch(`/flights/${missing}`)
      .set('If-Match', '"1"')
      .send({ basePrice: '1.00' })
      .expect(401);
  });
});
