#!/usr/bin/env node
/**
 * Fill the demo business with a few days' worth of realistic activity, so the
 * dashboard, reports, statements and notifications have something to show.
 *
 *   npm run seed            # fresh demo business (wipes the old one)
 *   npm run demo-data       # this script - run it once per seed
 *
 * It goes through the public API as the demo owner, exactly as the web app would,
 * so every business rule is exercised on the way: rates come from the pricing
 * engine, stock moves through the ledger, and balances change through the same
 * compare-and-swap code as real payments. Nothing is written to the database
 * directly.
 *
 * Needs the API running (npm run dev). Override the target or the login with
 * API_URL, DEMO_EMAIL and DEMO_PASSWORD; the defaults are the seeded demo owner.
 */

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const EMAIL = process.env.DEMO_EMAIL ?? 'owner@guptatraders.test';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'shopos-demo-2026';

let token = '';

async function call(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data: json.data, error: json.error };
}

const results = { done: 0, failed: 0 };

/** Run one step; report it, and carry on if it is refused so one miss cannot spoil the rest. */
async function step(label, request) {
  const response = await request;
  if (response.ok) {
    results.done += 1;
    console.log(`  ok    ${label}`);
  } else {
    results.failed += 1;
    console.log(`  MISS  ${label} -> ${response.status} ${response.error?.message ?? ''}`);
  }
  return response;
}

async function main() {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`\n  The API is not responding at ${API}. Start it with: npm run dev\n`);
    process.exit(1);
  }

  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (!login.ok) {
    console.error('\n  Could not sign in as the demo owner. Run `npm run seed` first.\n');
    process.exit(1);
  }
  token = login.data.accessToken;

  const [branches, products, customers, suppliers] = await Promise.all([
    call('GET', '/branches'),
    call('GET', '/products?limit=100'),
    call('GET', '/customers?limit=100'),
    call('GET', '/suppliers?limit=100'),
  ]);

  const branch = (branches.data ?? []).find((b) => b.code === 'BGP') ?? branches.data?.[0];
  const product = (name) => (products.data ?? []).find((p) => p.name.includes(name));
  const customer = (name) => (customers.data ?? []).find((c) => c.name.includes(name));
  const supplier = (name) => (suppliers.data ?? []).find((s) => s.name.includes(name));

  const needed = {
    branch,
    pencil: product('Natraj'),
    notebook: product('Classmate'),
    pen: product('Reynolds'),
    box: product('Camlin'),
    paper: product('A4 Copier'),
    bansal: customer('Bansal'),
    sharma: customer('Sharma'),
    vidya: customer('Vidya'),
    paperTraders: supplier('Rajesh'),
    camlin: supplier('Camlin'),
  };
  const missing = Object.entries(needed).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    console.error(`\n  The demo data is missing: ${missing.join(', ')}. Run \`npm run seed\` and try again.\n`);
    process.exit(1);
  }
  const { pencil, notebook, pen, box, paper, bansal, sharma, vidya, paperTraders, camlin } = needed;
  const branchId = branch._id;

  console.log('\nPurchasing');
  const po1 = await step(
    'Purchase order to Rajesh Paper Traders',
    call('POST', '/purchase-orders', {
      branchId,
      supplierId: paperTraders._id,
      items: [
        { productId: paper._id, orderedQty: 60, unitPricePaise: 21000 },
        { productId: notebook._id, orderedQty: 200, unitPricePaise: 3200 },
      ],
    }),
  );
  if (po1.ok) {
    await step('  sent to the supplier', call('POST', `/purchase-orders/${po1.data._id}/send`));
    await step(
      '  first delivery received (part of the order)',
      call('POST', `/purchase-orders/${po1.data._id}/receive`, {
        items: [
          { productId: paper._id, receivedQty: 40 },
          { productId: notebook._id, receivedQty: 120 },
        ],
      }),
    );
    await step(
      '  part-payment to the supplier',
      call('POST', '/supplier-payments', {
        branchId,
        supplierId: paperTraders._id,
        amountPaise: 500000,
        method: 'BANK_TRANSFER',
        reference: 'NEFT-DEMO-1',
        allocations: [{ purchaseOrderId: po1.data._id, amountPaise: 500000 }],
      }),
    );
  }
  const po2 = await step(
    'Purchase order to Camlin Wholesale Depot (still awaiting delivery)',
    call('POST', '/purchase-orders', {
      branchId,
      supplierId: camlin._id,
      items: [{ productId: box._id, orderedQty: 100, unitPricePaise: 6500 }],
    }),
  );
  if (po2.ok) await step('  sent to the supplier', call('POST', `/purchase-orders/${po2.data._id}/send`));

  console.log('\nSales');
  const walkIn = await step(
    'Walk-in cash sale',
    call('POST', '/invoices', {
      branchId,
      customerName: 'Walk-in customer',
      items: [
        { productId: pen._id, quantity: 12 },
        { productId: pencil._id, quantity: 20 },
      ],
    }),
  );
  if (walkIn.ok) {
    await step(
      '  paid in cash at the counter',
      call('POST', '/payments', {
        branchId,
        customerName: 'Walk-in customer',
        amountPaise: walkIn.data.totalPaise,
        method: 'CASH',
        allocations: [{ invoiceId: walkIn.data._id, amountPaise: walkIn.data.totalPaise }],
      }),
    );
  }

  await step(
    'Bansal Book Depot - credit sale (15 days)',
    call('POST', '/invoices', {
      branchId,
      customerId: bansal._id,
      items: [
        { productId: notebook._id, quantity: 60, discountPercent: 5 },
        { productId: pencil._id, quantity: 150 },
      ],
    }),
  );

  const sharmaBill = await step(
    'Sharma Stationers - credit sale (30 days)',
    call('POST', '/invoices', {
      branchId,
      customerId: sharma._id,
      items: [
        { productId: paper._id, quantity: 20 },
        { productId: pen._id, quantity: 100, discountPercent: 3 },
      ],
    }),
  );
  if (sharmaBill.ok) {
    await step(
      '  Sharma pays part by UPI',
      call('POST', '/payments', {
        branchId,
        customerId: sharma._id,
        amountPaise: Math.round(sharmaBill.data.totalPaise / 2),
        method: 'UPI',
        reference: 'UPI-DEMO-1',
        allocations: [{ invoiceId: sharmaBill.data._id, amountPaise: Math.round(sharmaBill.data.totalPaise / 2) }],
      }),
    );
  }

  const vidyaBill = await step(
    'Vidya Mandir School - credit sale (45 days)',
    call('POST', '/invoices', {
      branchId,
      customerId: vidya._id,
      items: [{ productId: notebook._id, quantity: 50 }],
    }),
  );
  if (vidyaBill.ok) {
    await step(
      '  Vidya Mandir pays in full by cheque',
      call('POST', '/payments', {
        branchId,
        customerId: vidya._id,
        amountPaise: vidyaBill.data.totalPaise,
        method: 'CHEQUE',
        reference: 'CHQ-DEMO-204',
        allocations: [{ invoiceId: vidyaBill.data._id, amountPaise: vidyaBill.data.totalPaise }],
      }),
    );
    await step(
      '  10 notebooks come back damaged (a return, with a credit)',
      call('POST', '/sales-returns', {
        invoiceId: vidyaBill.data._id,
        reason: 'DEFECTIVE',
        items: [{ productId: notebook._id, quantity: 10 }],
      }),
    );
  }

  const mistake = await step(
    'An invoice raised by mistake...',
    call('POST', '/invoices', {
      branchId,
      customerId: bansal._id,
      items: [{ productId: pen._id, quantity: 5 }],
    }),
  );
  if (mistake.ok) {
    await step('  ...and cancelled (its stock goes back)', call('POST', `/invoices/${mistake.data._id}/cancel`, { reason: 'Raised for the wrong customer' }));
  }

  console.log('\nQuotations and orders');
  const quote = await step(
    'Quotation to Vidya Mandir School',
    call('POST', '/quotations', {
      branchId,
      customerId: vidya._id,
      items: [
        { productId: notebook._id, quantity: 100, discountPercent: 8 },
        { productId: box._id, quantity: 40 },
      ],
    }),
  );
  if (quote.ok) await step('  sent to the customer', call('POST', `/quotations/${quote.data._id}/send`));

  const order = await step(
    'Sales order from Sharma Stationers',
    call('POST', '/sales-orders', {
      branchId,
      customerId: sharma._id,
      items: [{ productId: pencil._id, quantity: 200 }],
    }),
  );
  if (order.ok) await step('  confirmed', call('POST', `/sales-orders/${order.data._id}/confirm`));

  console.log(`\n  Finished: ${results.done} steps done, ${results.failed} refused.`);
  console.log('  Open the dashboard, Reports and a customer statement to see the result.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
