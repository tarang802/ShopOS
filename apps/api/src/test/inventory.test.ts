import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countStatus, newBusiness, startApi, type Business, type TestServer } from './testkit';

/**
 * Stock: the one number every other screen trusts.
 *
 * The central promise is that two terminals selling the last unit at the same instant
 * cannot both succeed, and that the cached balance can always be rebuilt from the
 * ledger. Both are properties of the database operation, so they are tested with real
 * parallel requests rather than reasoned about.
 */

let server: TestServer;
let shop: Business;

beforeAll(async () => {
  server = await startApi();
  shop = await newBusiness(server);
});

afterAll(async () => {
  await server.close();
});

async function stockAt(productId: string, branchId = shop.mainBranchId): Promise<number> {
  const detail = await shop.api.get(`/products/${productId}`);
  return detail.data.stock.find((row: any) => row.branchId === branchId)?.quantity ?? 0;
}

describe('selling the last units', () => {
  it('lets exactly as many sales through as there is stock, under real parallel load', async () => {
    const productId = await shop.product({ stock: 5, pricePaise: 1000 });

    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        shop.api.post('/invoices', { branchId: shop.mainBranchId, items: [{ productId, quantity: 1 }] }),
      ),
    );

    expect(countStatus(attempts, 201)).toBe(5);
    expect(countStatus(attempts, 422)).toBe(15);
    expect(attempts.every((attempt) => attempt.status < 500)).toBe(true);
    expect(await stockAt(productId)).toBe(0);
  });

  it('refuses a sale larger than the stock with a clear reason', async () => {
    const productId = await shop.product({ stock: 3 });
    const attempt = await shop.api.post('/invoices', { branchId: shop.mainBranchId, items: [{ productId, quantity: 4 }] });

    expect(attempt.status).toBe(422);
    expect(attempt.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(attempt.body.error.message).toContain('Available: 3');
    expect(await stockAt(productId)).toBe(3);
  });

  it('rolls the whole invoice back when one line cannot be filled', async () => {
    const plenty = await shop.product({ stock: 50 });
    const scarce = await shop.product({ stock: 1 });

    const attempt = await shop.api.post('/invoices', {
      branchId: shop.mainBranchId,
      items: [
        { productId: plenty, quantity: 10 },
        { productId: scarce, quantity: 5 },
      ],
    });

    expect(attempt.status).toBe(422);
    // The first line was already taken inside the transaction when the second failed.
    expect(await stockAt(plenty)).toBe(50);
  });
});

describe('what counts as a valid quantity', () => {
  it('refuses a fraction of a product counted in whole units', async () => {
    const productId = await shop.product({ stock: 10 });
    const attempt = await shop.api.post('/invoices', { branchId: shop.mainBranchId, items: [{ productId, quantity: 2.5 }] });

    expect(attempt.status).toBe(400);
    expect(attempt.body.error.message).toContain('whole');
  });
});

describe('negative stock', () => {
  it('is refused by default and allowed when the owner turns it on', async () => {
    const other = await newBusiness(server);
    const productId = await other.product({ stock: 2 });
    const sale = { branchId: other.mainBranchId, items: [{ productId, quantity: 5 }] };

    expect((await other.api.post('/invoices', sale)).status).toBe(422);

    const changed = await other.api.patch('/organizations/current', { settings: { allowNegativeStock: true } });
    expect(changed.status).toBe(200);

    expect((await other.api.post('/invoices', sale)).status).toBe(201);
    const detail = await other.api.get(`/products/${productId}`);
    expect(detail.data.stock[0].quantity).toBe(-3);
  });
});

describe('the ledger', () => {
  it('explains the balance: every movement is recorded and they sum to the stock', async () => {
    const productId = await shop.product({ stock: 100 });
    await shop.api.post('/invoices', { branchId: shop.mainBranchId, items: [{ productId, quantity: 30 }] });
    await shop.api.post('/inventory/adjustments', {
      branchId: shop.mainBranchId,
      reason: 'DAMAGE',
      items: [{ productId, countedQuantity: 60 }],
    });

    const movements = await shop.api.get(`/inventory/movements?productId=${productId}&limit=50`);
    const total = movements.data.reduce((sum: number, row: any) => sum + row.quantityDelta, 0);

    expect(total).toBe(await stockAt(productId));
    expect(total).toBe(60);
    expect(movements.data.map((row: any) => row.type).sort()).toEqual(['ADJUSTMENT', 'OPENING_STOCK', 'SALE']);
  });

  it('requires a reason to correct a count', async () => {
    const productId = await shop.product({ stock: 10 });
    const attempt = await shop.api.post('/inventory/adjustments', {
      branchId: shop.mainBranchId,
      items: [{ productId, countedQuantity: 5 }],
    });
    expect(attempt.status).toBe(400);
  });
});

describe('transfers between branches', () => {
  it('keeps goods in transit out of both branches until they arrive', async () => {
    const second = await shop.secondBranch();
    const productId = await shop.product({ stock: 100 });

    const sent = await shop.api.post('/inventory/transfers', {
      fromBranchId: shop.mainBranchId,
      toBranchId: second,
      items: [{ productId, quantity: 40 }],
    });
    expect(sent.status).toBe(201);
    expect(sent.data.status).toBe('IN_TRANSIT');
    expect(await stockAt(productId)).toBe(60);
    expect(await stockAt(productId, second)).toBe(0);

    const received = await shop.api.post(`/inventory/transfers/${sent.data._id}/receive`, {});
    expect(received.status).toBe(200);
    expect(await stockAt(productId, second)).toBe(40);
  });

  it('refuses to send more than the source branch holds', async () => {
    const second = await shop.secondBranch();
    const productId = await shop.product({ stock: 5 });
    const attempt = await shop.api.post('/inventory/transfers', {
      fromBranchId: shop.mainBranchId,
      toBranchId: second,
      items: [{ productId, quantity: 50 }],
    });
    expect(attempt.status).toBe(422);
  });
});

describe('stock alerts', () => {
  it('raises one low-stock alert when stock crosses the reorder level, and none after', async () => {
    const other = await newBusiness(server);
    const productId = await other.product({ name: 'Alert Pencil', stock: 12, reorderLevel: 10 });
    const sell = (quantity: number) =>
      other.api.post('/invoices', { branchId: other.mainBranchId, items: [{ productId, quantity }] });

    await sell(5); // 12 -> 7, crosses 10
    await new Promise((resolve) => setTimeout(resolve, 500));
    await sell(1); // 7 -> 6, already low: no new alert
    await new Promise((resolve) => setTimeout(resolve, 500));

    const alerts = await other.api.get('/notifications?limit=50');
    const low = alerts.data.filter((n: any) => n.type === 'LOW_STOCK');
    expect(low).toHaveLength(1);
    expect(low[0].title).toContain('Alert Pencil');

    await sell(6); // 6 -> 0
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await other.api.get('/notifications?limit=50');
    expect(after.data.filter((n: any) => n.type === 'OUT_OF_STOCK')).toHaveLength(1);
  });
});
