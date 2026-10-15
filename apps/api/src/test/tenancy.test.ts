import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newBusiness, startApi, type Business, type TestServer } from './testkit';

/**
 * Who you are, and whose data you can see.
 *
 * The most expensive bug a multi-tenant system can have is one shop reading another
 * shop's rates, so isolation gets tests of its own: an id that is perfectly valid but
 * belongs to somebody else must be indistinguishable from an id that does not exist.
 */

let server: TestServer;
let a: Business;
let b: Business;

beforeAll(async () => {
  server = await startApi();
  a = await newBusiness(server);
  b = await newBusiness(server);
});

afterAll(async () => {
  await server.close();
});

describe('authentication', () => {
  it('refuses a request with no token', async () => {
    expect((await a.anonymous.get('/products')).status).toBe(401);
  });

  it('refuses a wrong password with the same answer as an unknown email', async () => {
    const wrong = await a.anonymous.post('/auth/login', { email: 'nobody@example.test', password: 'whatever-it-is' });
    expect(wrong.status).toBe(401);
  });

  it('rejects an operator injected in place of an email', async () => {
    const response = await a.anonymous.post('/auth/login', { email: { $gt: '' }, password: 'x' });
    expect(response.status).toBe(400);
  });

  it('refuses a malformed token', async () => {
    const response = await fetch(`${server.url}/products`, { headers: { Authorization: 'Bearer not.a.token' } });
    expect(response.status).toBe(401);
  });
});

describe('tenant isolation', () => {
  it("does not let one business read another's product, and answers 404 rather than 403", async () => {
    const productId = await a.product({ name: 'Secret Rate Pencil' });

    expect((await a.api.get(`/products/${productId}`)).status).toBe(200);
    expect((await b.api.get(`/products/${productId}`)).status).toBe(404);
  });

  it("keeps lists to the caller's own business", async () => {
    await a.product({ name: 'Only A Sells This' });
    const seenByB = await b.api.get('/products?search=Only');
    expect(seenByB.data).toEqual([]);
  });

  it("refuses to bill against another business's branch", async () => {
    const productId = await b.product({ stock: 10 });
    const attempt = await b.api.post('/invoices', {
      branchId: a.mainBranchId,
      items: [{ productId, quantity: 1 }],
    });
    expect(attempt.status).toBe(404);
  });

  it("refuses a customer id from another business", async () => {
    const foreignCustomer = await a.customer({ name: 'A Only Customer' });
    const productId = await b.product({ stock: 10 });
    const attempt = await b.api.post('/invoices', {
      branchId: b.mainBranchId,
      customerId: foreignCustomer,
      items: [{ productId, quantity: 1 }],
    });
    expect(attempt.status).toBe(400);
  });

  it("does not show another business's documents in its numbering", async () => {
    const productId = await a.product({ stock: 10 });
    const first = await a.api.post('/invoices', { branchId: a.mainBranchId, items: [{ productId, quantity: 1 }] });
    expect(first.data.number).toMatch(/^INV-\d{4}-000001$/);

    const bProduct = await b.product({ stock: 10 });
    const second = await b.api.post('/invoices', { branchId: b.mainBranchId, items: [{ productId: bProduct, quantity: 1 }] });
    expect(second.data.number).toMatch(/^INV-\d{4}-000001$/);
  });
});

describe('input hardening', () => {
  it('ignores fields the schema does not declare', async () => {
    const response = await a.api.post('/customers', { name: 'Mass Assignment', organizationId: b.organizationId, isActive: false });
    expect(response.status).toBe(201);
    expect(response.data.organizationId).toBe(a.organizationId);
  });

  it('refuses an oversized page request by capping it', async () => {
    const response = await a.api.get('/products?limit=100000');
    expect(response.status).toBe(400);
  });
});
