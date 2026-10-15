import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientFor, newBusiness, startApi, type Business, type TestServer } from './testkit';

/**
 * The attacks a shop's data is most likely to meet: no login, a login without the
 * right, a hand-edited request, a hostile file name or search term.
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

const READ_ENDPOINTS = [
  '/products', '/inventory/balances', '/customers', '/invoices', '/quotations', '/sales-orders',
  '/sales-returns', '/suppliers', '/purchase-orders', '/purchase-returns', '/supplier-payments',
  '/payments', '/dashboard', '/notifications', '/reports', '/reports/sales-summary', '/audit-logs',
  '/users', '/roles', '/branches', '/organizations/current',
];

describe('nothing is readable without signing in', () => {
  it.each(READ_ENDPOINTS)('GET %s answers 401', async (path) => {
    expect((await a.anonymous.get(path)).status).toBe(401);
  });

  it('refuses a forged or garbled token', async () => {
    const forged = clientFor(server, 'not.a.token');
    expect((await forged.get('/products')).status).toBe(401);
  });
});

describe('a signed-in member only gets what the role allows', () => {
  it('keeps counter staff out of money reports, people and roles', async () => {
    const counter = await a.staff('SALES_STAFF');

    for (const path of ['/reports', '/reports/sales-summary', '/users', '/audit-logs', '/purchase-orders']) {
      expect((await counter.get(path)).status, path).toBe(403);
    }
    expect((await counter.post('/roles', { name: 'Sneaky', permissions: [] })).status).toBe(403);
  });

  it('never shows what goods cost to someone without the right', async () => {
    const productId = await a.product({ costPricePaise: 700, pricePaise: 1000 });
    const counter = await a.staff('SALES_STAFF');

    const seen = await counter.get(`/products/${productId}`);
    expect(seen.status).toBe(200);
    expect(JSON.stringify(seen.body)).not.toContain('costPricePaise');

    const listed = await counter.get('/products');
    expect(JSON.stringify(listed.body)).not.toContain('costPricePaise');

    const asOwner = await a.api.get(`/products/${productId}`);
    expect(asOwner.data.product.costPricePaise).toBe(700);
  });

  it('refuses to let a member grant themselves more', async () => {
    const counter = await a.staff('SALES_STAFF');
    const roles = await a.api.get('/roles');
    const owner = roles.data.find((role: any) => role.code === 'OWNER');
    const me = await counter.get('/auth/me');

    const attempt = await counter.patch(`/users/${me.data.user._id ?? me.data.user.id}`, { roleId: owner._id });
    expect(attempt.status).toBe(403);
  });
});

describe('a hand-edited request', () => {
  it('cannot place a record in somebody else\'s business', async () => {
    const created = await a.api.post('/customers', {
      name: 'Planted',
      organizationId: b.organizationId,
      createdBy: '000000000000000000000000',
    });
    expect(created.status).toBe(201);

    // Visible to its true owner, invisible to the business it tried to land in.
    expect((await a.api.get(`/customers/${created.data._id}`)).status).toBe(200);
    expect((await b.api.get(`/customers/${created.data._id}`)).status).toBe(404);
  });

  it('cannot set the paid amount of an invoice directly', async () => {
    const productId = await a.product({ pricePaise: 1000, stock: 10 });
    const customerId = await a.customer();
    const invoice = await a.api.post('/invoices', {
      branchId: a.mainBranchId,
      customerId,
      items: [{ productId, quantity: 1 }],
      paidPaise: 99999999,
      status: 'PAID',
    });

    expect(invoice.status).toBe(201);
    expect(invoice.data.paidPaise).toBe(0);
    expect(invoice.data.status).not.toBe('PAID');
  });

  it('treats operators in a query string as plain text, never as a query', async () => {
    for (const path of [
      '/invoices?status[$ne]=PAID',
      '/customers?search[$regex]=.*',
      '/products?sortBy[$gt]=',
      '/payments?customerId[$ne]=x',
    ]) {
      const response = await a.api.get(path);
      expect(response.status, path).toBeLessThan(500);
    }
  });

  it('does not let a search term be turned into a runaway pattern', async () => {
    await a.customer({ name: 'Plain Name' });
    const started = Date.now();
    const response = await a.api.get(`/customers?search=${encodeURIComponent('(a+)+$')}`);
    expect(response.status).toBe(200);
    expect(response.data.length).toBe(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses a request body past the size limit', async () => {
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const response = await a.api.post('/customers', { name: 'Big', notes: huge });
    expect(response.status).toBe(413);
  });

  it('refuses ids that are not ids with a clean 400, not a crash', async () => {
    for (const path of ['/products/not-an-id', '/invoices/123', '/customers/%7B%24ne%3A1%7D']) {
      const response = await a.api.get(path);
      expect(response.status, path).toBe(400);
    }
  });
});

describe('what a failure reveals', () => {
  it('never includes a stack trace or database wording in an error', async () => {
    const bad = await a.api.get('/products/not-an-id');
    const text = JSON.stringify(bad.body);
    expect(text).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    expect(text).not.toMatch(/mongo|mongoose|CastError|ObjectId/i);
  });

  it('answers an unknown route with a plain 404', async () => {
    const response = await a.api.get('/definitely-not-a-route');
    expect(response.status).toBe(404);
  });

  it('sends the security headers and hides the framework', async () => {
    const response = await fetch(`${server.url}/health`);
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('strict-transport-security')).toBeTruthy();
  });

  it('refuses a browser from an origin that is not on the list', async () => {
    const response = await fetch(`${server.url}/products`, { headers: { Origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
  });
});

describe('a spreadsheet export', () => {
  it('defuses a customer named like a formula', async () => {
    const productId = await a.product({ pricePaise: 1000, stock: 10 });
    const customerId = await a.customer({ name: '=HYPERLINK("http://evil.example","pay")' });
    const sold = await a.api.post('/invoices', {
      branchId: a.mainBranchId,
      customerId,
      items: [{ productId, quantity: 1 }],
    });
    expect(sold.status).toBe(201);

    const response = await fetch(`${server.url}/reports/sales-summary?groupBy=customer&format=csv`, {
      headers: { Authorization: `Bearer ${a.token}` },
    });
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|[\r\n,])=HYPERLINK/);
  });
});
