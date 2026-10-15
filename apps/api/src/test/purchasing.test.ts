import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countStatus, newBusiness, startApi, type Business, type TestServer } from './testkit';

/**
 * Buying, receiving and paying suppliers.
 *
 * Ordering is not receiving, and receiving is not owing: a purchase order moves no
 * stock, only a delivery does, and only delivered goods are a debt. These tests hold
 * that line, and prove that two people receiving or paying the same order at the
 * same moment cannot count it twice.
 */

let server: TestServer;
let shop: Business;
let supplierId: string;

beforeAll(async () => {
  server = await startApi();
  shop = await newBusiness(server);
  supplierId = await shop.supplier({ creditDays: 30 });
});

afterAll(async () => {
  await server.close();
});

async function order(productId: string, orderedQty = 100, unitPricePaise = 300) {
  const created = await shop.api.post('/purchase-orders', {
    branchId: shop.mainBranchId,
    supplierId,
    items: [{ productId, orderedQty, unitPricePaise }],
  });
  expect(created.status).toBe(201);
  await shop.api.post(`/purchase-orders/${created.data._id}/send`);
  return created.data as { _id: string; number: string };
}

const receive = (poId: string, productId: string, receivedQty: number) =>
  shop.api.post(`/purchase-orders/${poId}/receive`, { items: [{ productId, receivedQty }] });

const pay = (poId: string, amountPaise: number, extra: Record<string, unknown> = {}) =>
  shop.api.post('/supplier-payments', {
    branchId: shop.mainBranchId,
    supplierId,
    amountPaise,
    method: 'BANK_TRANSFER',
    allocations: [{ purchaseOrderId: poId, amountPaise }],
    ...extra,
  });

async function stock(productId: string) {
  const detail = await shop.api.get(`/products/${productId}`);
  return detail.data.stock[0]?.quantity ?? 0;
}

describe('receiving goods', () => {
  it('moves no stock when ordered, and exactly what arrived when received', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId);
    expect(await stock(productId)).toBe(0);

    const first = await receive(po._id, productId, 60);
    expect(first.data.purchaseOrder.status).toBe('PARTIALLY_RECEIVED');
    expect(await stock(productId)).toBe(60);

    const second = await receive(po._id, productId, 40);
    expect(second.data.purchaseOrder.status).toBe('RECEIVED');
    expect(await stock(productId)).toBe(100);
  });

  it('refuses to receive more than is outstanding', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId);
    expect((await receive(po._id, productId, 101)).status).toBe(422);
  });

  it('counts a delivery once when five people confirm it at the same moment', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId);

    const attempts = await Promise.all(Array.from({ length: 5 }, () => receive(po._id, productId, 100)));
    expect(countStatus(attempts, 201)).toBe(1);
    expect(attempts.every((attempt) => attempt.status < 500)).toBe(true);
    expect(await stock(productId)).toBe(100);
  });

  it('will not receive against a draft that was never sent', async () => {
    const productId = await shop.product({ stock: 0 });
    const draft = await shop.api.post('/purchase-orders', {
      branchId: shop.mainBranchId,
      supplierId,
      items: [{ productId, orderedQty: 10, unitPricePaise: 100 }],
    });
    expect((await receive(draft.data._id, productId, 5)).status).toBe(422);
  });

  it('lets a stock hand receive goods but not pay for them', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId);
    const hand = await shop.staff('INVENTORY_STAFF');

    const received = await hand.post(`/purchase-orders/${po._id}/receive`, { items: [{ productId, receivedQty: 10 }] });
    expect(received.status).toBe(201);

    const paid = await hand.post('/supplier-payments', {
      branchId: shop.mainBranchId,
      supplierId,
      amountPaise: 100,
      method: 'CASH',
      allocations: [{ purchaseOrderId: po._id, amountPaise: 100 }],
    });
    expect(paid.status).toBe(403);
  });
});

describe('what a product costs', () => {
  it('keeps a moving average as deliveries arrive at different prices', async () => {
    // 100 on the shelf at Rs 3.00, then 100 more at Rs 5.00: the cost is now Rs 4.00.
    const productId = await shop.product({ stock: 100, costPricePaise: 300 });
    const po = await order(productId, 100, 500);
    await receive(po._id, productId, 100);

    const detail = await shop.api.get(`/products/${productId}`);
    expect(detail.data.product.costPricePaise).toBe(400);
  });
});

describe('what is owed to a supplier', () => {
  it('is the value of goods received, less payments, not the value of the order', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId, 100, 300);

    let detail = await shop.api.get(`/purchase-orders/${po._id}`);
    expect(detail.data.owedPaise).toBe(0);
    expect(detail.data.payableCapPaise).toBe(30000);

    await receive(po._id, productId, 60); // 18000 received
    expect((await pay(po._id, 10000)).status).toBe(201);

    detail = await shop.api.get(`/purchase-orders/${po._id}`);
    expect(detail.data.receivedValuePaise).toBe(18000);
    expect(detail.data.owedPaise).toBe(8000);
    expect(detail.data.payableStatus).toBe('PARTIALLY_PAID');
  });

  it('allows a deposit before delivery but never more than the order is worth', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId, 10, 100); // worth 1000

    expect((await pay(po._id, 400)).status).toBe(201);
    expect((await pay(po._id, 601)).status).toBe(422);
    expect((await pay(po._id, 600)).status).toBe(201);
  });

  it('runs the due date from the first delivery by the supplier credit days', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId);
    await receive(po._id, productId, 10);

    const detail = await shop.api.get(`/purchase-orders/${po._id}`);
    const days = Math.round((new Date(detail.data.dueDate).getTime() - Date.now()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(31);
  });

  it('lets one of five simultaneous payments through', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId, 10, 100);

    const attempts = await Promise.all(Array.from({ length: 5 }, () => pay(po._id, 1000)));
    expect(countStatus(attempts, 201)).toBe(1);
    expect(attempts.every((attempt) => attempt.status < 500)).toBe(true);

    const detail = await shop.api.get(`/purchase-orders/${po._id}`);
    expect(detail.data.paidPaise).toBe(1000);
  });

  it('can be voided, and an order with payments cannot be cancelled', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId, 10, 100);
    const paid = await pay(po._id, 500);

    expect((await shop.api.post(`/purchase-orders/${po._id}/cancel`)).status).toBe(422);

    const voided = await shop.api.post(`/supplier-payments/${paid.data._id}/void`, { reason: 'wrong order' });
    expect(voided.data.status).toBe('VOIDED');
    expect((await shop.api.get(`/purchase-orders/${po._id}`)).data.paidPaise).toBe(0);
    expect((await shop.api.post(`/supplier-payments/${paid.data._id}/void`, {})).status).toBe(422);
  });

  it("refuses to pay another supplier's order", async () => {
    const other = await shop.supplier({ name: 'Somebody Else' });
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId, 10, 100);

    const attempt = await shop.api.post('/supplier-payments', {
      branchId: shop.mainBranchId,
      supplierId: other,
      amountPaise: 100,
      method: 'CASH',
      allocations: [{ purchaseOrderId: po._id, amountPaise: 100 }],
    });
    expect(attempt.status).toBe(422);
  });
});

describe('sending goods back', () => {
  it('takes stock out and takes the value off what is owed', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId, 100, 300);
    await receive(po._id, productId, 100);
    await pay(po._id, 10000);

    const returned = await shop.api.post('/purchase-returns', {
      purchaseOrderId: po._id,
      reason: 'DEFECTIVE',
      items: [{ productId, quantity: 30 }],
    });
    expect(returned.status).toBe(201);
    expect(returned.data.totalPaise).toBe(9000);
    expect(await stock(productId)).toBe(70);

    const detail = await shop.api.get(`/purchase-orders/${po._id}`);
    expect(detail.data.owedPaise).toBe(30000 - 9000 - 10000);
  });

  it('allows only what was delivered and not already sent back', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId, 100, 100);
    await receive(po._id, productId, 50);

    const send = (quantity: number) =>
      shop.api.post('/purchase-returns', {
        purchaseOrderId: po._id,
        reason: 'OTHER',
        items: [{ productId, quantity }],
      });

    expect((await send(51)).status).toBe(422);
    expect((await send(50)).status).toBe(201);
    expect((await send(1)).status).toBe(422);
  });

  it('lets only one of two simultaneous full returns through', async () => {
    const productId = await shop.product({ stock: 0 });
    const po = await order(productId, 10, 100);
    await receive(po._id, productId, 10);
    const body = { purchaseOrderId: po._id, reason: 'OTHER', items: [{ productId, quantity: 10 }] };

    const attempts = await Promise.all([shop.api.post('/purchase-returns', body), shop.api.post('/purchase-returns', body)]);
    expect(countStatus(attempts, 201)).toBe(1);
    expect(attempts.every((attempt) => attempt.status < 500)).toBe(true);
  });
});

describe('the supplier statement', () => {
  it('closes on exactly the amount the summary says is owed', async () => {
    const other = await newBusiness(server);
    const owed = await other.supplier({ name: 'Statement Supplier' });
    const productId = await other.product({ stock: 0 });

    const po = await other.api.post('/purchase-orders', {
      branchId: other.mainBranchId,
      supplierId: owed,
      items: [{ productId, orderedQty: 100, unitPricePaise: 300 }],
    });
    await other.api.post(`/purchase-orders/${po.data._id}/send`);
    await other.api.post(`/purchase-orders/${po.data._id}/receive`, { items: [{ productId, receivedQty: 60 }] });
    await other.api.post('/supplier-payments', {
      branchId: other.mainBranchId,
      supplierId: owed,
      amountPaise: 5000,
      method: 'CASH',
      allocations: [{ purchaseOrderId: po.data._id, amountPaise: 5000 }],
    });
    await other.api.post('/purchase-returns', {
      purchaseOrderId: po.data._id,
      reason: 'OTHER',
      items: [{ productId, quantity: 10 }],
    });

    const summary = await other.api.get(`/suppliers/${owed}/summary`);
    const statement = await other.api.get(`/suppliers/${owed}/statement`);

    expect(summary.data.owedPaise).toBe(18000 - 5000 - 3000);
    expect(statement.data.closingBalancePaise).toBe(summary.data.owedPaise);
    expect(statement.data.entries.map((entry: any) => entry.type).sort()).toEqual(['PAYMENT', 'RECEIPT', 'RETURN']);
  });
});
