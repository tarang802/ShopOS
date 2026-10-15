import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countStatus, newBusiness, startApi, type Business, type TestServer } from './testkit';

/**
 * Selling and getting paid.
 *
 * These are the paths where a wrong paisa or a double-counted payment becomes a
 * dispute with a customer, so each one is exercised through the real API, and the
 * race conditions are tested with real parallel requests.
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

const invoice = (productId: string, quantity: number, extra: Record<string, unknown> = {}) =>
  shop.api.post('/invoices', {
    branchId: shop.mainBranchId,
    items: [{ productId, quantity, ...((extra.line as object) ?? {}) }],
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'line')),
  });

describe('rate slabs at the till', () => {
  it('prices each quantity from the slab it falls in, including both edges', async () => {
    const productId = await shop.product({
      stock: 10_000,
      tiers: [
        { minQuantity: 1, maxQuantity: 9, pricePaise: 500 },
        { minQuantity: 10, maxQuantity: 49, pricePaise: 480 },
        { minQuantity: 50, maxQuantity: null, pricePaise: 420 },
      ],
    });

    const expected: [number, number][] = [
      [1, 500],
      [9, 500],
      [10, 480],
      [49, 480],
      [50, 420],
      [5000, 420],
    ];
    for (const [quantity, price] of expected) {
      const resolved = await shop.api.get(`/pricing/resolve?productId=${productId}&quantity=${quantity}`);
      expect(resolved.data.unitPricePaise, `quantity ${quantity}`).toBe(price);
    }
  });

  it('refuses overlapping slabs rather than guessing', async () => {
    const productId = await shop.product({ pricePaise: 500 });
    const attempt = await shop.api.put(`/pricing/products/${productId}`, {
      priceListId: shop.priceListId,
      tiers: [
        { minQuantity: 1, maxQuantity: 10, pricePaise: 500 },
        { minQuantity: 5, maxQuantity: 20, pricePaise: 480 },
      ],
    });
    expect(attempt.status).toBe(422);
  });
});

describe('invoice arithmetic', () => {
  it('takes the discount off before tax and freezes every figure', async () => {
    // 100 at Rs 4.20 = 42000, 5% off = 2100, taxable 39900, 12% tax = 4788, total 44688.
    const productId = await shop.product({ pricePaise: 420, taxRatePercent: 12, stock: 1000, costPricePaise: 336 });
    const made = await invoice(productId, 100, { line: { discountPercent: 5 } });

    expect(made.status).toBe(201);
    expect(made.data.items[0]).toMatchObject({
      grossPaise: 42000,
      discountPaise: 2100,
      subtotalPaise: 39900,
      taxPaise: 4788,
      lineTotalPaise: 44688,
      unitCostPaise: 336,
    });
    expect(made.data.totalPaise).toBe(44688);
    expect(made.data.outstandingPaise).toBe(44688);
  });

  it('keeps showing what was charged after the rate changes', async () => {
    const productId = await shop.product({ pricePaise: 1000, stock: 10 });
    const made = await invoice(productId, 2);

    await shop.api.put(`/pricing/products/${productId}`, {
      priceListId: shop.priceListId,
      tiers: [{ minQuantity: 1, maxQuantity: null, pricePaise: 9999 }],
    });

    const later = await shop.api.get(`/invoices/${made.data._id}`);
    expect(later.data.items[0].unitPricePaise).toBe(1000);
  });

  it('does not sell an archived product', async () => {
    const productId = await shop.product({ stock: 10 });
    await shop.api.post(`/products/${productId}/archive`, { isActive: false });
    expect((await invoice(productId, 1)).status).toBe(400);
  });
});

describe('who may discount', () => {
  it('lets counter staff give up to the threshold and no more, while the owner may go beyond', async () => {
    const productId = await shop.product({ stock: 100, pricePaise: 1000 });
    const staff = await shop.staff('SALES_STAFF');
    const sale = (percent: number, client = staff) =>
      client.post('/invoices', {
        branchId: shop.mainBranchId,
        items: [{ productId, quantity: 1, discountPercent: percent }],
      });

    expect((await sale(10)).status).toBe(201);
    expect((await sale(15)).status).toBe(403);
    expect((await sale(15, shop.api)).status).toBe(201);
  });

  it('does not show cost to people without the costs permission', async () => {
    const productId = await shop.product({ stock: 10, costPricePaise: 700 });
    const staff = await shop.staff('SALES_STAFF');

    const asStaff = await staff.post('/invoices', { branchId: shop.mainBranchId, items: [{ productId, quantity: 1 }] });
    expect('unitCostPaise' in asStaff.data.items[0]).toBe(false);

    const asOwner = await shop.api.get(`/invoices/${asStaff.data._id}`);
    expect(asOwner.data.items[0].unitCostPaise).toBe(700);

    const product = await staff.get(`/products/${productId}`);
    expect(product.data.product.costPricePaise).toBeUndefined();
  });
});

describe('payments', () => {
  it('lets exactly one of five simultaneous payments settle the same bill', async () => {
    const customerId = await shop.customer();
    const productId = await shop.product({ stock: 50, pricePaise: 1000 });
    const made = await invoice(productId, 5, { customerId });
    const total = made.data.totalPaise;

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        shop.api.post('/payments', {
          branchId: shop.mainBranchId,
          customerId,
          amountPaise: total,
          method: 'CASH',
          allocations: [{ invoiceId: made.data._id, amountPaise: total }],
        }),
      ),
    );

    expect(countStatus(attempts, 201)).toBe(1);
    expect(attempts.every((attempt) => attempt.status < 500)).toBe(true);
    const settled = await shop.api.get(`/invoices/${made.data._id}`);
    expect(settled.data.paidPaise).toBe(total);
    expect(settled.data.status).toBe('PAID');
  });

  it('refuses a payment that is not fully applied, so money cannot vanish', async () => {
    const customerId = await shop.customer();
    const productId = await shop.product({ stock: 10, pricePaise: 1000 });
    const made = await invoice(productId, 1, { customerId });

    const attempt = await shop.api.post('/payments', {
      branchId: shop.mainBranchId,
      customerId,
      amountPaise: 1000,
      method: 'CASH',
      allocations: [{ invoiceId: made.data._id, amountPaise: 400 }],
    });
    expect(attempt.status).toBe(422);
  });

  it("refuses to settle one customer's bill with another's payment", async () => {
    const payer = await shop.customer({ name: 'Payer' });
    const owner = await shop.customer({ name: 'Owner of the bill' });
    const productId = await shop.product({ stock: 10 });
    const made = await invoice(productId, 1, { customerId: owner });

    const attempt = await shop.api.post('/payments', {
      branchId: shop.mainBranchId,
      customerId: payer,
      amountPaise: 100,
      method: 'CASH',
      allocations: [{ invoiceId: made.data._id, amountPaise: 100 }],
    });
    expect(attempt.status).toBe(422);
  });

  it('takes payment in the same step as the sale, atomically', async () => {
    const productId = await shop.product({ stock: 10, pricePaise: 1000 });
    const made = await invoice(productId, 1, { payment: { method: 'UPI', amountPaise: 500, reference: 'UPI-1' } });

    expect(made.status).toBe(201);
    expect(made.data.paidPaise).toBe(500);
    expect(made.data.status).toBe('PARTIALLY_PAID');
  });

  it('can be voided, which re-opens the bill and frees it to be cancelled', async () => {
    const productId = await shop.product({ stock: 10, pricePaise: 1000 });
    const made = await invoice(productId, 1, { payment: { method: 'CASH', amountPaise: 1120 } });
    expect(made.data.status).toBe('PAID');

    expect((await shop.api.post(`/invoices/${made.data._id}/cancel`, {})).status).toBe(422);

    const detail = await shop.api.get(`/invoices/${made.data._id}`);
    const voided = await shop.api.post(`/payments/${detail.data.payments[0]._id}/void`, { reason: 'bounced' });
    expect(voided.data.status).toBe('VOIDED');

    const reopened = await shop.api.get(`/invoices/${made.data._id}`);
    expect(reopened.data.status).toBe('ISSUED');
    expect(reopened.data.outstandingPaise).toBe(1120);
    expect((await shop.api.post(`/invoices/${made.data._id}/cancel`, {})).status).toBe(200);
  });

  it('cannot be voided by someone without the permission', async () => {
    const productId = await shop.product({ stock: 10 });
    const made = await invoice(productId, 1, { payment: { method: 'CASH', amountPaise: 100 } });
    const detail = await shop.api.get(`/invoices/${made.data._id}`);
    const staff = await shop.staff('SALES_STAFF');

    expect((await staff.post(`/payments/${detail.data.payments[0]._id}/void`, {})).status).toBe(403);
  });
});

describe('returns', () => {
  it('credits a line returned in several goes exactly once, to the paisa', async () => {
    // 10 at Rs 4.80 + 12% = 5376. Returning 3, then 2, then 5 must total 5376 exactly.
    const productId = await shop.product({ stock: 100, pricePaise: 480, taxRatePercent: 12 });
    const made = await invoice(productId, 10);
    expect(made.data.totalPaise).toBe(5376);

    const credits: number[] = [];
    for (const quantity of [3, 2, 5]) {
      const returned = await shop.api.post('/sales-returns', {
        invoiceId: made.data._id,
        reason: 'DEFECTIVE',
        items: [{ productId, quantity }],
      });
      expect(returned.status).toBe(201);
      credits.push(returned.data.creditPaise);
    }

    expect(credits).toEqual([1613, 1075, 2688]);
    expect(credits.reduce((sum, credit) => sum + credit, 0)).toBe(5376);

    const after = await shop.api.get(`/invoices/${made.data._id}`);
    expect(after.data.returnedPaise).toBe(5376);
    expect(after.data.status).toBe('RETURNED');
  });

  it('returns restocked goods to the shelf but not damaged ones', async () => {
    const productId = await shop.product({ stock: 20 });
    const made = await invoice(productId, 10);

    await shop.api.post('/sales-returns', {
      invoiceId: made.data._id,
      reason: 'OTHER',
      items: [{ productId, quantity: 4, restock: true }],
    });
    await shop.api.post('/sales-returns', {
      invoiceId: made.data._id,
      reason: 'DEFECTIVE',
      items: [{ productId, quantity: 2, restock: false }],
    });

    const detail = await shop.api.get(`/products/${productId}`);
    expect(detail.data.stock[0].quantity).toBe(20 - 10 + 4);
  });

  it('refuses to return more than was sold or already returned', async () => {
    const productId = await shop.product({ stock: 20 });
    const made = await invoice(productId, 5);

    const first = { invoiceId: made.data._id, reason: 'OTHER', items: [{ productId, quantity: 4 }] };
    expect((await shop.api.post('/sales-returns', first)).status).toBe(201);
    expect((await shop.api.post('/sales-returns', first)).status).toBe(422);
  });

  it('refunds only what a customer has overpaid, never more', async () => {
    const customerId = await shop.customer();
    const productId = await shop.product({ stock: 20, pricePaise: 1000, taxRatePercent: 0 });
    const made = await invoice(productId, 10, { customerId, payment: { method: 'CASH', amountPaise: 10000 } });

    const returned = await shop.api.post('/sales-returns', {
      invoiceId: made.data._id,
      reason: 'OTHER',
      items: [{ productId, quantity: 4 }],
    });
    expect(returned.data.creditPaise).toBe(4000);

    const tooMuch = await shop.api.post(`/sales-returns/${returned.data._id}/refund`, { method: 'CASH', amountPaise: 4001 });
    expect(tooMuch.status).toBe(422);

    const ok = await shop.api.post(`/sales-returns/${returned.data._id}/refund`, { method: 'CASH', amountPaise: 4000 });
    expect(ok.status).toBe(200);

    const settled = await shop.api.get(`/invoices/${made.data._id}`);
    expect(settled.data.refundDuePaise).toBe(0);
    expect(settled.data.outstandingPaise).toBe(0);
  });

  it('lets only one of two simultaneous full returns through', async () => {
    const productId = await shop.product({ stock: 20 });
    const made = await invoice(productId, 10);
    const body = { invoiceId: made.data._id, reason: 'OTHER', items: [{ productId, quantity: 10 }] };

    const attempts = await Promise.all([shop.api.post('/sales-returns', body), shop.api.post('/sales-returns', body)]);
    expect(countStatus(attempts, 201)).toBe(1);
    expect(attempts.every((attempt) => attempt.status < 500)).toBe(true);
  });
});

describe('quotations and sales orders', () => {
  it('turns a quotation into an order at the quoted terms, once, however many try', async () => {
    const productId = await shop.product({ stock: 100, pricePaise: 1000 });
    const quote = await shop.api.post('/quotations', {
      branchId: shop.mainBranchId,
      items: [{ productId, quantity: 10, discountPercent: 5 }],
    });
    expect(quote.status).toBe(201);

    const attempts = await Promise.all(
      Array.from({ length: 3 }, () => shop.api.post(`/quotations/${quote.data._id}/convert-to-order`)),
    );
    expect(countStatus(attempts, 201)).toBe(1);
    expect(attempts.every((attempt) => attempt.status < 500)).toBe(true);

    const order = attempts.find((attempt) => attempt.status === 201)!;
    expect(order.data.totalPaise).toBe(quote.data.totalPaise);
  });

  it('invoices an order in parts and never beyond what it asked for', async () => {
    const productId = await shop.product({ stock: 100, pricePaise: 1000 });
    const order = await shop.api.post('/sales-orders', { branchId: shop.mainBranchId, items: [{ productId, quantity: 10 }] });
    await shop.api.post(`/sales-orders/${order.data._id}/confirm`);

    const first = await shop.api.post(`/sales-orders/${order.data._id}/invoice`, { items: [{ productId, quantity: 6 }] });
    expect(first.status).toBe(201);
    expect(first.data.order.status).toBe('PARTIALLY_INVOICED');

    expect((await shop.api.post(`/sales-orders/${order.data._id}/invoice`, { items: [{ productId, quantity: 5 }] })).status).toBe(422);

    const rest = await shop.api.post(`/sales-orders/${order.data._id}/invoice`, {});
    expect(rest.data.invoice.items[0].quantity).toBe(4);
    expect(rest.data.order.status).toBe('INVOICED');
  });

  it('bills a confirmed order once when four people invoice it at the same moment', async () => {
    const productId = await shop.product({ stock: 100 });
    const order = await shop.api.post('/sales-orders', { branchId: shop.mainBranchId, items: [{ productId, quantity: 10 }] });
    await shop.api.post(`/sales-orders/${order.data._id}/confirm`);

    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => shop.api.post(`/sales-orders/${order.data._id}/invoice`, {})),
    );
    expect(countStatus(attempts, 201)).toBe(1);
    expect(attempts.every((attempt) => attempt.status < 500)).toBe(true);
  });

  it('hands quantity back to the order when its invoice is cancelled', async () => {
    const productId = await shop.product({ stock: 100 });
    const order = await shop.api.post('/sales-orders', { branchId: shop.mainBranchId, items: [{ productId, quantity: 10 }] });
    await shop.api.post(`/sales-orders/${order.data._id}/confirm`);
    const billed = await shop.api.post(`/sales-orders/${order.data._id}/invoice`, {});

    await shop.api.post(`/invoices/${billed.data.invoice._id}/cancel`, {});
    const reopened = await shop.api.get(`/sales-orders/${order.data._id}`);
    expect(reopened.data.status).toBe('CONFIRMED');
    expect(reopened.data.items[0].invoicedQty).toBe(0);
  });
});

describe('credit limits', () => {
  it('refuses a sale past the limit only when the business switches enforcement on', async () => {
    const other = await newBusiness(server);
    const customerId = await other.customer({ creditLimitPaise: 5000 });
    const productId = await other.product({ stock: 100, pricePaise: 1000, taxRatePercent: 0 });
    const sale = (quantity: number) =>
      other.api.post('/invoices', { branchId: other.mainBranchId, customerId, items: [{ productId, quantity }] });

    expect((await sale(8)).status).toBe(201); // Rs 80 against a Rs 50 limit: allowed, it is only a reference

    await other.api.patch('/organizations/current', { settings: { enforceCreditLimit: true } });
    const refused = await sale(1);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
  });
});
