import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Invoice } from '../db/models';
import { newBusiness, startApi, type Business, type TestServer } from './testkit';

/**
 * Reports and statements.
 *
 * A report is only worth having if it agrees with the documents behind it, so these
 * tests build a small business with figures worked out by hand and check the reports
 * against them - and check that the different views of the same money agree with
 * each other.
 */

let server: TestServer;
let shop: Business;
let pencil: string;
let notebook: string;
let bansal: string;
let sharma: string;

beforeAll(async () => {
  server = await startApi();
  shop = await newBusiness(server);

  pencil = await shop.product({ name: 'Pencil', stock: 1000, pricePaise: 420, taxRatePercent: 12, costPricePaise: 336 });
  notebook = await shop.product({ name: 'Notebook', stock: 1000, pricePaise: 4200, taxRatePercent: 12, costPricePaise: 2911 });
  bansal = await shop.customer({ name: 'Bansal', creditDays: 15 });
  sharma = await shop.customer({ name: 'Sharma' });

  // Invoice 1: 100 pencils. Net 42000, tax 5040, total 47040, cost 33600.
  await shop.api.post('/invoices', { branchId: shop.mainBranchId, customerId: bansal, items: [{ productId: pencil, quantity: 100 }] });

  // Invoice 2: 10 notebooks, 10% off. Gross 42000, discount 4200, net 37800, tax 4536, total 42336.
  const second = await shop.api.post('/invoices', {
    branchId: shop.mainBranchId,
    customerId: sharma,
    items: [{ productId: notebook, quantity: 10, discountPercent: 10 }],
  });
  // 4 of the 10 notebooks come back, so 60% of that invoice stands.
  await shop.api.post('/sales-returns', {
    invoiceId: second.data._id,
    reason: 'OTHER',
    items: [{ productId: notebook, quantity: 4 }],
  });
});

afterAll(async () => {
  await server.close();
});

describe('the sales report', () => {
  it('works the figures out after discount, tax and returns', async () => {
    const report = await shop.api.get('/reports/sales-summary?groupBy=branch');
    expect(report.status).toBe(200);

    const totals = report.data.totals;
    expect(totals.invoices).toBe(2);
    expect(totals.netPaise).toBe(42000 + 22680); // 60% of 37800 is 22680
    expect(totals.costPaise).toBe(33600 + 6 * 2911);
    expect(totals.marginPaise).toBe(64680 - 51066);
    expect(Math.abs(totals.taxPaise - (5040 + 2722))).toBeLessThanOrEqual(1);
    expect(Math.abs(totals.totalPaise - (47040 + 25402))).toBeLessThanOrEqual(1);
  });

  it('breaks down by product and by customer, and the parts add up to the whole', async () => {
    const byProduct = await shop.api.get('/reports/sales-summary?groupBy=product');
    const labels = byProduct.data.rows.map((row: any) => row.label).sort();
    expect(labels).toEqual(['Notebook', 'Pencil']);
    expect(byProduct.data.rows.find((row: any) => row.label === 'Notebook').units).toBe(6);
    expect(byProduct.data.rows.reduce((sum: number, row: any) => sum + row.netPaise, 0)).toBe(byProduct.data.totals.netPaise);

    const byCustomer = await shop.api.get('/reports/sales-summary?groupBy=customer');
    expect(byCustomer.data.rows.map((row: any) => row.label).sort()).toEqual(['Bansal', 'Sharma']);
  });

  it('reads an empty period as empty rather than failing', async () => {
    const report = await shop.api.get('/reports/sales-summary?groupBy=day&from=2020-01-01&to=2020-01-31');
    expect(report.data.rows).toEqual([]);
  });

  it('refuses a backwards range and an unknown grouping', async () => {
    expect((await shop.api.get('/reports/sales-summary?from=2026-12-31&to=2026-01-01')).status).toBe(400);
    expect((await shop.api.get('/reports/sales-summary?groupBy=nonsense')).status).toBe(400);
    expect((await shop.api.get('/reports/not-a-report')).status).toBe(404);
  });
});

describe('who may see which report', () => {
  it('keeps reports from people without the reports permission', async () => {
    const counter = await shop.staff('SALES_STAFF');
    expect((await counter.get('/reports/sales-summary')).status).toBe(403);
  });

  it('shows cost and margin to an accountant, who holds costs:view', async () => {
    const accountant = await shop.staff('ACCOUNTANT');
    const report = await accountant.get('/reports/sales-summary?groupBy=branch');
    expect(report.data.columns.some((column: any) => column.key === 'marginPaise')).toBe(true);
    expect((await accountant.get('/reports/stock-valuation')).status).toBe(200);
  });

  it('lists only the reports the caller may run', async () => {
    const catalog = await shop.api.get('/reports');
    expect(catalog.data.map((entry: any) => entry.key)).toContain('stock-valuation');
  });
});

describe('stock value', () => {
  it('adds up the same whichever way it is cut', async () => {
    const byCategory = await shop.api.get('/reports/stock-valuation?groupBy=category');
    const byBranch = await shop.api.get('/reports/stock-valuation?groupBy=branch');
    const byProduct = await shop.api.get('/reports/stock-valuation?groupBy=product');

    expect(byCategory.data.totals.valuePaise).toBe(byBranch.data.totals.valuePaise);
    expect(byBranch.data.totals.valuePaise).toBe(byProduct.data.totals.valuePaise);
    expect(byProduct.data.totals.valuePaise).toBeGreaterThan(0);
  });
});

describe('receivables aging', () => {
  it('places a bill 45 days late in the 31-60 bucket and nowhere else', async () => {
    const aged = await shop.customer({ name: 'Slow Payer' });
    const made = await shop.api.post('/invoices', {
      branchId: shop.mainBranchId,
      customerId: aged,
      items: [{ productId: pencil, quantity: 10 }],
    });
    await Invoice.updateOne(
      { organizationId: new Types.ObjectId(shop.organizationId), _id: made.data._id },
      { $set: { dueDate: new Date(Date.now() - 45 * 86_400_000) } },
    );

    const report = await shop.api.get('/reports/receivables-aging');
    const row = report.data.rows.find((entry: any) => entry.label === 'Slow Payer');

    expect(row.d31_60Paise).toBe(made.data.totalPaise);
    expect([row.currentPaise, row.d1_30Paise, row.d61_90Paise, row.d90PlusPaise]).toEqual([0, 0, 0, 0]);
    expect(row.totalPaise).toBe(made.data.totalPaise);
  });

  it('agrees with what the customer summary says is owed', async () => {
    const report = await shop.api.get('/reports/receivables-aging');
    const summary = await shop.api.get(`/customers/${sharma}/summary`);
    const row = report.data.rows.find((entry: any) => entry.label === 'Sharma');

    expect(row.totalPaise).toBe(summary.data.outstandingPaise);
  });
});

describe('statements', () => {
  it('closes on the net balance the summary reports, including money owed back', async () => {
    const customerId = await shop.customer({ name: 'Statement Customer' });
    const productId = await shop.product({ stock: 100, pricePaise: 1000, taxRatePercent: 0 });

    const made = await shop.api.post('/invoices', {
      branchId: shop.mainBranchId,
      customerId,
      items: [{ productId, quantity: 10 }],
      payment: { method: 'CASH', amountPaise: 10000 },
    });
    await shop.api.post('/sales-returns', {
      invoiceId: made.data._id,
      reason: 'OTHER',
      items: [{ productId, quantity: 4 }],
    });

    const summary = await shop.api.get(`/customers/${customerId}/summary`);
    const statement = await shop.api.get(`/customers/${customerId}/statement`);

    expect(summary.data.refundDuePaise).toBe(4000);
    expect(statement.data.closingBalancePaise).toBe(summary.data.netBalancePaise);
    expect(summary.data.netBalancePaise).toBe(-4000);
    expect(statement.data.totalDebitPaise - statement.data.totalCreditPaise).toBe(statement.data.closingBalancePaise);
  });

  it('carries earlier activity in as the opening balance of a later period', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const full = await shop.api.get(`/customers/${sharma}/statement`);
    const later = await shop.api.get(`/customers/${sharma}/statement?from=${tomorrow}`);

    expect(later.data.openingBalancePaise).toBe(full.data.closingBalancePaise);
    expect(later.data.entries).toEqual([]);
  });
});

describe('spreadsheet export', () => {
  it('writes money in rupees and defuses names that would run as formulas', async () => {
    await shop.api.post('/customers', { name: '=HYPERLINK("http://evil.test","click")' });
    const evil = await shop.api.get('/customers?search=HYPERLINK');
    await shop.api.post('/invoices', {
      branchId: shop.mainBranchId,
      customerId: evil.data[0]._id,
      items: [{ productId: pencil, quantity: 1 }],
    });

    const csv = (await shop.api.get('/reports/sales-summary?groupBy=customer&format=csv')).body.raw as string;

    expect(csv.split('\n')[0]).toContain('Customer');
    expect(csv).toMatch(/\d+\.\d{2}/);
    expect(csv).toContain("'=HYPERLINK");
    expect(/(^|,)"?=HYPERLINK/m.test(csv)).toBe(false);
  });
});

describe('the dashboard', () => {
  it('agrees with the reports on what is owed', async () => {
    const dashboard = await shop.api.get('/dashboard');
    const aging = await shop.api.get('/reports/receivables-aging');

    expect(dashboard.data.receivables.outstandingPaise).toBe(aging.data.totals.totalPaise);
    expect(dashboard.data.sales.trend).toHaveLength(14);
  });

  it('leaves out the sections someone may not see', async () => {
    const hand = await shop.staff('INVENTORY_STAFF');
    const dashboard = await hand.get('/dashboard');

    expect(dashboard.status).toBe(200);
    expect(dashboard.data.sales).toBeNull();
    expect(dashboard.data.receivables).toBeNull();
    expect(dashboard.data.payables).not.toBeNull();
    expect(dashboard.data.lowStock).not.toBeNull();
  });
});
