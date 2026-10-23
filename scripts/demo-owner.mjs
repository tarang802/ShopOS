#!/usr/bin/env node
/**
 * Build a believable shop from nothing, the way an owner would use ShopOS.
 *
 *   node scripts/demo-owner.mjs build   <owner-email> [business name]
 *   node scripts/demo-owner.mjs facts                     (collect figures for the report)
 *
 * `build` registers the owner (the same call the sign-up page makes), then sets up
 * the shop - branches, rates, products, stock, staff, customers, suppliers - and runs
 * a few weeks of trade: buying, selling on credit, collecting, returning, voiding,
 * transferring and quoting. Everything goes through the public API, so every
 * business rule is exercised and some steps are *expected* to be refused (selling
 * past a credit limit, paying more than is owed); those are recorded as refusals.
 *
 * The generated password is written to demo/credentials.json (git-ignored), never
 * printed. `facts` signs in and writes demo/facts.json for the written report.
 *
 * Needs the API running. Override its address with API_URL.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const DIR = new URL('../demo/', import.meta.url);
const CREDENTIALS = new URL('credentials.json', DIR);
const FACTS = new URL('facts.json', DIR);

const rupees = (value) => Math.round(value * 100);

async function http(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data: json.data, body: json, error: json.error };
}

const client = (token) => ({
  get: (path) => http(token, 'GET', path),
  post: (path, body) => http(token, 'POST', path, body ?? {}),
  put: (path, body) => http(token, 'PUT', path, body ?? {}),
  patch: (path, body) => http(token, 'PATCH', path, body ?? {}),
});

/* -------------------------------------------------------------------------- */
/* Step reporting                                                             */
/* -------------------------------------------------------------------------- */

const log = { ok: 0, refused: 0, failed: 0, refusals: [] };

function section(title) {
  console.log(`\n${title}`);
}

/** A step that must succeed. */
async function must(label, request) {
  const response = await request;
  if (!response.ok) {
    log.failed += 1;
    console.log(`  FAIL  ${label} -> ${response.status} ${response.error?.message ?? ''}`);
    return response;
  }
  log.ok += 1;
  console.log(`  ok    ${label}`);
  return response;
}

/** A step the system is supposed to refuse; getting through would be the bug. */
async function mustRefuse(label, rule, request) {
  const response = await request;
  if (response.ok) {
    log.failed += 1;
    console.log(`  FAIL  ${label} -> was allowed, should have been refused`);
  } else {
    log.refused += 1;
    log.refusals.push({ label, rule, status: response.status, message: response.error?.message ?? '' });
    console.log(`  held  ${label} -> ${response.status} ${response.error?.message ?? ''}`);
  }
  return response;
}

/* -------------------------------------------------------------------------- */
/* The shop                                                                   */
/* -------------------------------------------------------------------------- */

// name, brand, category, unit, retail rupees, tax %, reorder level, [bhagalpur, patna, ranchi] opening stock
const CATALOGUE = [
  ['Natraj 621 Pencil', 'Natraj', 'Pencils', 'pcs', 5, 12, 300, [4000, 900, 400]],
  ['Apsara Platinum Pencil', 'Apsara', 'Pencils', 'pcs', 6, 12, 300, [3500, 800, 350]],
  ['Natraj Eraser', 'Natraj', 'Pencils', 'pcs', 4, 12, 200, [2000, 500, 200]],
  ['Reynolds 045 Ball Pen', 'Reynolds', 'Pens', 'pcs', 10, 12, 400, [3000, 700, 300]],
  ['Cello Butterflow Pen', 'Cello', 'Pens', 'pcs', 10, 12, 300, [2500, 600, 250]],
  ['Camlin Kokuyo Gel Pen', 'Camlin', 'Pens', 'pcs', 20, 12, 150, [1200, 300, 120]],
  ['Classmate Notebook 172 Pages', 'Classmate', 'Notebooks', 'pcs', 38, 12, 100, [1500, 400, 150]],
  ['Classmate Notebook 120 Pages', 'Classmate', 'Notebooks', 'pcs', 28, 12, 100, [1800, 450, 160]],
  ['Classmate Long Book 240 Pages', 'Classmate', 'Notebooks', 'pcs', 62, 12, 80, [900, 250, 90]],
  ['Camlin Geometry Box', 'Camlin', 'Instruments', 'pcs', 85, 12, 25, [400, 120, 30]],
  ['Apsara Pencil Box', 'Apsara', 'Instruments', 'pcs', 45, 12, 30, [300, 90, 25]],
  ['Faber-Castell Sketch Pens 12', 'Faber-Castell', 'Art & Craft', 'pkt', 70, 12, 40, [500, 140, 40]],
  ['Camlin Wax Crayons 24', 'Camlin', 'Art & Craft', 'box', 55, 12, 40, [600, 150, 45]],
  ['Fevicol MR 100g', 'Fevicol', 'Adhesives', 'pcs', 38, 18, 30, [350, 80, 8]],
  ['Fevikwik 5g', 'Fevicol', 'Adhesives', 'pcs', 12, 18, 60, [700, 160, 60]],
  ['A4 Copier Paper 500 Sheets', 'JK Paper', 'Paper', 'pkt', 270, 12, 40, [700, 150, 30]],
  ['A4 Copier Paper 75 GSM Ream', 'JK Paper', 'Paper', 'pkt', 310, 12, 30, [400, 80, 20]],
  ['Chart Paper Assorted (Pack of 10)', 'JK Paper', 'Paper', 'pkt', 60, 12, 30, [450, 100, 30]],
  ['Stapler Pins 24/6', 'Kangaro', 'Office Supplies', 'box', 14, 18, 60, [900, 200, 70]],
  ['Kangaro Stapler HP-10', 'Kangaro', 'Office Supplies', 'pcs', 95, 18, 20, [160, 40, 12]],
  ['Gum Tape 2 inch', 'Cello', 'Office Supplies', 'pcs', 42, 18, 40, [500, 120, 35]],
  ['Whiteboard Marker (Black)', 'Camlin', 'Office Supplies', 'pcs', 22, 12, 80, [1000, 250, 90]],
  ['Highlighter Pen (Yellow)', 'Faber-Castell', 'Pens', 'pcs', 30, 12, 60, [600, 150, 50]],
  ['Pencil Sharpener Metal', 'Apsara', 'Pencils', 'pcs', 6, 12, 150, [1500, 400, 150]],
];

const CUSTOMERS = [
  // name, city, price list, credit days, credit limit rupees
  ['Bansal Book Depot', 'Bhagalpur', 'WHOLESALE', 15, 60000],
  ['Sharma Stationers', 'Patna', 'WHOLESALE', 30, 100000],
  ['Vidya Mandir School', 'Bhagalpur', 'WHOLESALE', 45, 80000],
  ['Saraswati Public School', 'Patna', 'DEALER', 45, 150000],
  ['Anand Book Centre', 'Ranchi', 'WHOLESALE', 30, 20000],
  ['Kumar Xerox & Stationery', 'Bhagalpur', 'RETAIL', 7, 15000],
  ['Gupta Gift Corner', 'Patna', 'RETAIL', 0, 0],
  ['Maa Durga Kirana Store', 'Ranchi', 'RETAIL', 15, 25000],
  ['Singh General Store', 'Ranchi', 'DEALER', 30, 90000],
  ['St. Xavier Coaching Classes', 'Patna', 'WHOLESALE', 30, 50000],
];

const SUPPLIERS = [
  ['Rajesh Paper Traders', 'Delhi', 'Delhi', 30],
  ['Natraj Distributors', 'Kolkata', 'West Bengal', 15],
  ['Camlin Wholesale Depot', 'Mumbai', 'Maharashtra', 45],
  ['Reynolds Pens Agency', 'Patna', 'Bihar', 21],
  ['Kangaro Office Supplies', 'Ludhiana', 'Punjab', 30],
];

function priceCards(retailPaise) {
  const p = retailPaise;
  const at = (factor) => Math.max(1, Math.round(p * factor));
  return {
    RETAIL: [
      { minQuantity: 1, maxQuantity: 9, pricePaise: at(1) },
      { minQuantity: 10, maxQuantity: 49, pricePaise: at(0.96) },
      { minQuantity: 50, maxQuantity: 99, pricePaise: at(0.92) },
      { minQuantity: 100, maxQuantity: null, pricePaise: at(0.88) },
    ],
    WHOLESALE: [
      { minQuantity: 1, maxQuantity: 49, pricePaise: at(0.9) },
      { minQuantity: 50, maxQuantity: 199, pricePaise: at(0.85) },
      { minQuantity: 200, maxQuantity: null, pricePaise: at(0.8) },
    ],
    DEALER: [
      { minQuantity: 1, maxQuantity: 99, pricePaise: at(0.84) },
      { minQuantity: 100, maxQuantity: 499, pricePaise: at(0.8) },
      { minQuantity: 500, maxQuantity: null, pricePaise: at(0.76) },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* build                                                                      */
/* -------------------------------------------------------------------------- */

async function build(email, businessName) {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`\n  The API is not responding at ${API}. Start it first (npm run dev).\n`);
    process.exit(1);
  }
  const saved = existsSync(CREDENTIALS) ? JSON.parse(readFileSync(CREDENTIALS, 'utf8')) : null;
  if (saved && (!saved.adopt || saved.built)) {
    console.error('\n  demo/credentials.json already exists - this shop was built before.');
    console.error('  Delete the demo folder and the shop in the database first to rebuild.\n');
    process.exit(1);
  }

  const password = randomBytes(9).toString('base64url');
  const staffPassword = randomBytes(9).toString('base64url');

  section('1. The owner signs up');
  let credentials;
  let registered;
  if (saved?.adopt) {
    // The account already exists (it was created with Google sign-in and has an empty
    // shop); a password login was added to it, so sign in rather than register.
    registered = await must(`Sign in as ${saved.owner.email} to its existing, empty "${businessName}"`, http(null, 'POST', '/auth/login', saved.owner));
    if (!registered.ok) process.exit(1);
    credentials = { ...saved, staff: [] };
  } else {
    registered = await must(
      `Register ${email} with a new business "${businessName}"`,
      http(null, 'POST', '/auth/register', {
        name: 'Tarang Gupta',
        email,
        password,
        phone: '9876500001',
        businessName,
        businessType: 'Wholesale',
        city: 'Bhagalpur',
        branchName: 'Bhagalpur (Main)',
      }),
    );
    if (!registered.ok) process.exit(1);
    mkdirSync(DIR, { recursive: true });
    credentials = { owner: { email, password }, staff: [], organizationId: registered.data.organization.id };
  }
  const saveCredentials = () => writeFileSync(CREDENTIALS, JSON.stringify(credentials, null, 2));
  saveCredentials();

  const ownerToken = registered.data.accessToken;
  const owner = client(ownerToken);

  section('2. Setting up the shop');
  await must(
    'Business profile and selling rules (discount cap 10%, credit limits enforced, invoice footer)',
    owner.patch('/organizations/current', {
      phone: '9876500001',
      addressLine: 'Station Road',
      city: 'Bhagalpur',
      state: 'Bihar',
      pincode: '812001',
      settings: {
        maxDiscountPercent: 10,
        enforceCreditLimit: true,
        lowStockThreshold: 20,
        allowNegativeStock: false,
        invoiceFooter: 'Goods once sold will not be taken back after 7 days. Subject to Bhagalpur jurisdiction.',
        paymentInstructions: 'Pay by cash, UPI, cheque or NEFT. Ask the counter for bank details.',
      },
    }),
  );

  const branchList = await owner.get('/branches');
  const hq = branchList.data[0];
  if (hq.name !== 'Bhagalpur (Main)') {
    await must('Name the head-office branch', owner.patch(`/branches/${hq._id}`, { name: 'Bhagalpur (Main)', city: 'Bhagalpur', state: 'Bihar' }));
  }
  const patna = (await must('Add the Patna branch', owner.post('/branches', { name: 'Patna', code: 'PAT', city: 'Patna', state: 'Bihar' }))).data;
  const ranchi = (await must('Add the Ranchi branch', owner.post('/branches', { name: 'Ranchi', code: 'RNC', city: 'Ranchi', state: 'Jharkhand' }))).data;

  const unitList = (await owner.get('/units?limit=100')).data;
  const unit = (symbol) => unitList.find((u) => u.symbol === symbol)?._id ?? unitList.find((u) => u.symbol === 'pcs')._id;
  const lists = (await owner.get('/pricing/lists')).data;
  const listId = (code) => lists.find((l) => l.code === code)?._id;

  const categories = {};
  for (const name of [...new Set(CATALOGUE.map((row) => row[2]))]) {
    categories[name] = (await owner.post('/categories', { name })).data?._id;
  }
  const brands = {};
  for (const name of [...new Set(CATALOGUE.map((row) => row[1]))]) {
    brands[name] = (await owner.post('/brands', { name })).data?._id;
  }
  console.log(`  ok    ${Object.keys(categories).length} categories and ${Object.keys(brands).length} brands`);
  log.ok += 1;

  section('3. The catalogue, rate slabs and opening stock');
  const productIds = {};
  const stockByBranch = { [hq._id]: [], [patna._id]: [], [ranchi._id]: [] };
  let barcode = 8901000100000;
  for (const [name, brand, category, symbol, retailRupees, tax, reorder, stock] of CATALOGUE) {
    const retail = rupees(retailRupees);
    const cost = Math.round(retail * 0.68);
    barcode += 7;
    const created = await owner.post('/products', {
      name,
      brandId: brands[brand],
      categoryId: categories[category],
      unitId: unit(symbol),
      taxRatePercent: tax,
      reorderLevel: reorder,
      costPricePaise: cost,
      barcodes: [{ code: String(barcode), type: 'EAN13' }],
    });
    if (!created.ok) {
      log.failed += 1;
      console.log(`  FAIL  product ${name} -> ${created.status} ${created.error?.message ?? ''}`);
      continue;
    }
    const productId = created.data._id;
    productIds[name] = productId;
    const cards = priceCards(retail);
    for (const code of ['RETAIL', 'WHOLESALE', 'DEALER']) {
      const priced = await owner.put(`/pricing/products/${productId}`, { priceListId: listId(code), tiers: cards[code] });
      if (!priced.ok) {
        log.failed += 1;
        console.log(`  FAIL  rates for ${name} (${code}) -> ${priced.error?.message ?? priced.status}`);
      }
    }
    stockByBranch[hq._id].push({ productId, quantity: stock[0] });
    stockByBranch[patna._id].push({ productId, quantity: stock[1] });
    stockByBranch[ranchi._id].push({ productId, quantity: stock[2] });
  }
  log.ok += 1;
  console.log(`  ok    ${Object.keys(productIds).length} products, each with Retail / Wholesale / Dealer slabs`);
  for (const [branchId, label] of [[hq._id, 'Bhagalpur'], [patna._id, 'Patna'], [ranchi._id, 'Ranchi']]) {
    await must(`Opening stock at ${label}`, owner.post('/inventory/opening-stock', { branchId, items: stockByBranch[branchId] }));
  }
  const P = (name) => productIds[name];

  section('4. Staff and what each may do');
  const roles = (await owner.get('/roles')).data;
  const roleId = (code) => roles.find((r) => r.code === code)._id;
  const allPermissions = (await owner.get('/roles/permissions')).data;
  const wanted = [
    'products:view', 'pricing:view', 'inventory:view', 'sales:view', 'sales:create', 'sales:return',
    'customers:view', 'customers:manage', 'payments:view', 'payments:create',
  ].filter((permission) => allPermissions.includes(permission));
  const supervisorRole = await must(
    'A custom role: Counter Supervisor (sell, take returns, take payments, no reports or costs)',
    owner.post('/roles', { name: 'Counter Supervisor', description: 'Runs the counter; can take returns', permissions: wanted }),
  );

  const staffPlan = [
    { name: 'Sunita Kumari', handle: 'sunita.kumari', role: roleId('SALES_STAFF'), roleName: 'Sales staff', branches: [patna._id] },
    { name: 'Vikram Singh', handle: 'vikram', role: roleId('MANAGER'), roleName: 'Manager', branches: [patna._id, ranchi._id] },
    { name: 'Anil Yadav', handle: 'anil', role: roleId('INVENTORY_STAFF'), roleName: 'Inventory staff', branches: [hq._id] },
    { name: 'Meena Agarwal', handle: 'meena', role: roleId('ACCOUNTANT'), roleName: 'Accountant', branches: null },
    ...(supervisorRole.ok
      ? [{ name: 'Rohit Kumar', handle: 'rohit', role: supervisorRole.data._id, roleName: 'Counter Supervisor', branches: [ranchi._id] }]
      : []),
  ];
  const staffTokens = {};
  const staffDomain = email.includes('@') ? 'guptatraders.test' : 'guptatraders.test';
  for (const member of staffPlan) {
    const staffEmail = `${member.handle}@${staffDomain}`;
    const created = await must(
      `${member.name} joins as ${member.roleName}${member.branches ? ' (limited to their branches)' : ' (all branches)'}`,
      owner.post('/users', {
        name: member.name,
        email: staffEmail,
        password: staffPassword,
        roleId: member.role,
        allBranches: member.branches === null,
        branchIds: member.branches ?? [],
      }),
    );
    if (created.ok) {
      credentials.staff.push({ name: member.name, role: member.roleName, email: staffEmail, branches: member.branches ? member.branches.length : 'all' });
      const login = await http(null, 'POST', '/auth/login', { email: staffEmail, password: staffPassword });
      if (login.ok) staffTokens[member.handle] = login.data.accessToken;
    }
  }
  credentials.staffPassword = staffPassword;
  saveCredentials();
  const sunita = client(staffTokens['sunita.kumari']);
  const meena = client(staffTokens.meena);
  const anil = client(staffTokens.anil);
  const vikram = client(staffTokens.vikram);

  section('5. Customers and suppliers');
  const customerIds = {};
  for (const [name, city, listCode, creditDays, limit] of CUSTOMERS) {
    const created = await owner.post('/customers', {
      name,
      city,
      phone: `98${Math.floor(10000000 + Math.random() * 89999999)}`,
      defaultPriceListId: listId(listCode),
      creditDays,
      ...(limit ? { creditLimitPaise: rupees(limit) } : {}),
    });
    customerIds[name] = created.data?._id;
    if (!created.ok) {
      log.failed += 1;
      console.log(`  FAIL  customer ${name} -> ${created.error?.message ?? created.status}`);
    }
  }
  log.ok += 1;
  console.log(`  ok    ${CUSTOMERS.length} customers with credit terms and limits`);
  const supplierIds = {};
  for (const [name, city, state, creditDays] of SUPPLIERS) {
    const created = await owner.post('/suppliers', { name, city, state, creditDays, phone: `97${Math.floor(10000000 + Math.random() * 89999999)}` });
    supplierIds[name] = created.data?._id;
  }
  log.ok += 1;
  console.log(`  ok    ${SUPPLIERS.length} suppliers with credit terms`);
  const C = (name) => customerIds[name];
  const S = (name) => supplierIds[name];

  section('6. Buying stock');
  const order = async (supplier, items, label) =>
    must(label, owner.post('/purchase-orders', {
      branchId: hq._id,
      supplierId: S(supplier),
      items: items.map(([name, orderedQty, unitPricePaise]) => ({ productId: P(name), orderedQty, unitPricePaise })),
    }));
  const send = (po) => must('  sent to the supplier', owner.post(`/purchase-orders/${po.data._id}/send`));

  const po1 = await order('Rajesh Paper Traders', [
    ['A4 Copier Paper 500 Sheets', 300, rupees(182)],
    ['Chart Paper Assorted (Pack of 10)', 200, rupees(40)],
  ], 'Order paper from Rajesh Paper Traders');
  if (po1.ok) {
    await send(po1);
    await must('  full delivery received', anil.post(`/purchase-orders/${po1.data._id}/receive`, { items: [
      { productId: P('A4 Copier Paper 500 Sheets'), receivedQty: 300 },
      { productId: P('Chart Paper Assorted (Pack of 10)'), receivedQty: 200 },
    ] }));
    const owed = 300 * rupees(182) + 200 * rupees(40);
    await must('  paid in full by bank transfer (the accountant)', meena.post('/supplier-payments', {
      branchId: hq._id, supplierId: S('Rajesh Paper Traders'), amountPaise: owed, method: 'BANK_TRANSFER', reference: 'NEFT-RPT-1048',
      allocations: [{ purchaseOrderId: po1.data._id, amountPaise: owed }],
    }));
  }

  const po2 = await order('Natraj Distributors', [
    ['Natraj 621 Pencil', 5000, rupees(3.4)],
    ['Natraj Eraser', 3000, rupees(2.7)],
  ], 'Order pencils and erasers from Natraj Distributors');
  if (po2.ok) {
    await send(po2);
    await must('  first lorry: 60% of the order arrives', anil.post(`/purchase-orders/${po2.data._id}/receive`, { items: [
      { productId: P('Natraj 621 Pencil'), receivedQty: 3000 },
      { productId: P('Natraj Eraser'), receivedQty: 1800 },
    ] }));
    await must('  part-payment made', meena.post('/supplier-payments', {
      branchId: hq._id, supplierId: S('Natraj Distributors'), amountPaise: rupees(8000), method: 'UPI', reference: 'UPI-ND-221',
      allocations: [{ purchaseOrderId: po2.data._id, amountPaise: rupees(8000) }],
    }));
  }

  const po3 = await order('Camlin Wholesale Depot', [
    ['Camlin Geometry Box', 300, rupees(57)],
    ['Camlin Wax Crayons 24', 400, rupees(37)],
  ], 'Order from Camlin Wholesale Depot (still on the way)');
  if (po3.ok) await send(po3);

  const po4 = await order('Reynolds Pens Agency', [
    ['Reynolds 045 Ball Pen', 4000, rupees(6.8)],
    ['Cello Butterflow Pen', 2000, rupees(6.8)],
  ], 'Order pens from Reynolds Pens Agency');
  if (po4.ok) {
    await send(po4);
    await must('  delivery received, left unpaid (money we owe)', anil.post(`/purchase-orders/${po4.data._id}/receive`, { items: [
      { productId: P('Reynolds 045 Ball Pen'), receivedQty: 4000 },
      { productId: P('Cello Butterflow Pen'), receivedQty: 2000 },
    ] }));
    await must('  300 faulty pens sent back (reduces what we owe)', owner.post('/purchase-returns', {
      purchaseOrderId: po4.data._id, reason: 'DEFECTIVE', items: [{ productId: P('Reynolds 045 Ball Pen'), quantity: 300 }],
    }));
  }

  const po5 = await order('Kangaro Office Supplies', [['Kangaro Stapler HP-10', 100, rupees(62)]], 'Draft an order to Kangaro (not sent yet)');
  const po6 = await order('Camlin Wholesale Depot', [['Whiteboard Marker (Black)', 500, rupees(14)]], 'Order markers from Camlin (to be cancelled)');
  if (po6.ok) await must('  cancelled before it was sent', owner.post(`/purchase-orders/${po6.data._id}/cancel`));
  void po5;

  section('7. Moving and correcting stock');
  const transfer = await must('Send stock Bhagalpur -> Patna', owner.post('/inventory/transfers', {
    fromBranchId: hq._id, toBranchId: patna._id,
    items: [{ productId: P('Classmate Notebook 172 Pages'), quantity: 300 }, { productId: P('A4 Copier Paper 500 Sheets'), quantity: 100 }],
  }));
  if (transfer.ok) await must('  received at Patna', vikram.post(`/inventory/transfers/${transfer.data._id}/receive`, {}));
  await must('Send stock Bhagalpur -> Ranchi (left in transit on purpose)', owner.post('/inventory/transfers', {
    fromBranchId: hq._id, toBranchId: ranchi._id,
    items: [{ productId: P('Fevicol MR 100g'), quantity: 120 }, { productId: P('Camlin Geometry Box'), quantity: 60 }],
  }));
  await must('Damaged stock written off (reason recorded)', anil.post('/inventory/adjustments', {
    branchId: hq._id, reason: 'DAMAGE', notes: 'Water leak in the godown, notebooks spoilt',
    items: [{ productId: P('Classmate Notebook 120 Pages'), countedQuantity: 1740 }],
  }));
  await must('Physical count corrects a miscount', anil.post('/inventory/adjustments', {
    branchId: hq._id, reason: 'PHYSICAL_COUNT', notes: 'Monthly stock count',
    items: [{ productId: P('Stapler Pins 24/6'), countedQuantity: 880 }],
  }));

  section('8. Selling');
  const sale = (who, branchId, customerName, items, extra = {}) =>
    who.post('/invoices', {
      branchId,
      ...(C(customerName) ? { customerId: C(customerName) } : { customerName }),
      items: items.map(([name, quantity, discountPercent]) => ({ productId: P(name), quantity, ...(discountPercent ? { discountPercent } : {}) })),
      ...extra,
    });
  const payInFull = (who, invoice, branchId, customerName, method, reference) =>
    who.post('/payments', {
      branchId,
      ...(C(customerName) ? { customerId: C(customerName) } : { customerName }),
      amountPaise: invoice.totalPaise, method, ...(reference ? { reference } : {}),
      allocations: [{ invoiceId: invoice._id, amountPaise: invoice.totalPaise }],
    });

  // Walk-in counter sales
  const walkIns = [
    [owner, hq._id, [['Reynolds 045 Ball Pen', 6], ['Natraj 621 Pencil', 12]], 'CASH'],
    [owner, hq._id, [['Classmate Notebook 120 Pages', 8]], 'UPI'],
    [sunita, patna._id, [['Camlin Geometry Box', 2], ['Apsara Pencil Box', 2]], 'CASH'],
    [sunita, patna._id, [['Fevikwik 5g', 10], ['Gum Tape 2 inch', 3]], 'UPI'],
    [owner, hq._id, [['A4 Copier Paper 500 Sheets', 4]], 'CARD'],
  ];
  for (const [who, branchId, items, method] of walkIns) {
    const made = await must(`Walk-in sale (${method}) at ${branchId === hq._id ? 'Bhagalpur' : 'Patna'}`, sale(who, branchId, 'Walk-in customer', items));
    if (made.ok) await must('  paid at the counter', payInFull(who, made.data, branchId, 'Walk-in customer', method));
  }
  const payNow = await must('Sale with the money taken in the same step ("pay now")', sale(sunita, patna._id, 'Gupta Gift Corner', [['Camlin Wax Crayons 24', 6], ['Faber-Castell Sketch Pens 12', 4]], {
    payment: { method: 'UPI', amountPaise: rupees(300), reference: 'UPI-GGC-1' },
  }));
  void payNow;

  // Credit sales
  const credit = {};
  const creditSale = async (key, who, branchId, customer, items, label) => {
    credit[key] = await must(label, sale(who, branchId, customer, items));
    return credit[key];
  };
  await creditSale('bansal1', owner, hq._id, 'Bansal Book Depot', [['Classmate Notebook 172 Pages', 120, 5], ['Natraj 621 Pencil', 600], ['Reynolds 045 Ball Pen', 300]], 'Bansal Book Depot buys on 15 days credit');
  await creditSale('sharma1', owner, hq._id, 'Sharma Stationers', [['A4 Copier Paper 500 Sheets', 80], ['Classmate Notebook 120 Pages', 200, 6]], 'Sharma Stationers buys on 30 days credit');
  await creditSale('vidya1', owner, hq._id, 'Vidya Mandir School', [['Classmate Notebook 172 Pages', 250, 8], ['Camlin Geometry Box', 60]], 'Vidya Mandir School buys for the new session');
  await creditSale('saraswati1', owner, patna._id, 'Saraswati Public School', [['Classmate Long Book 240 Pages', 200, 10], ['Apsara Pencil Box', 60], ['Faber-Castell Sketch Pens 12', 80]], 'Saraswati Public School orders at the dealer rate');
  await creditSale('singh1', vikram, ranchi._id, 'Singh General Store', [['Fevikwik 5g', 40], ['Natraj Eraser', 150], ['Pencil Sharpener Metal', 100]], 'Singh General Store (Ranchi, by the manager)');
  await creditSale('xavier1', owner, patna._id, 'St. Xavier Coaching Classes', [['Whiteboard Marker (Black)', 120], ['Highlighter Pen (Yellow)', 60]], 'St. Xavier Coaching Classes');
  await creditSale('kumar1', sunita, patna._id, 'Kumar Xerox & Stationery', [['A4 Copier Paper 75 GSM Ream', 20]], 'Kumar Xerox buys paper (a Patna sale)');
  await creditSale('durga1', owner, hq._id, 'Maa Durga Kirana Store', [['Natraj 621 Pencil', 100], ['Cello Butterflow Pen', 100]], 'Maa Durga Kirana Store');
  await creditSale('bansal2', owner, hq._id, 'Bansal Book Depot', [['Stapler Pins 24/6', 100], ['Gum Tape 2 inch', 40]], 'Bansal Book Depot orders again');
  await creditSale('sharma2', owner, hq._id, 'Sharma Stationers', [['Camlin Kokuyo Gel Pen', 100]], 'Sharma Stationers: a small second bill');
  await creditSale('mistake', owner, hq._id, 'Gupta Gift Corner', [['Natraj Eraser', 50]], 'A bill raised for the wrong customer');

  section('9. Collecting money');
  const pay = (invoice, customer, branchId, amountPaise, method, reference, who = meena) =>
    who.post('/payments', {
      branchId, customerId: C(customer), amountPaise, method, reference,
      allocations: [{ invoiceId: invoice._id, amountPaise }],
    });
  if (credit.vidya1?.ok) await must('Vidya Mandir pays in full by cheque (the accountant records it)', pay(credit.vidya1.data, 'Vidya Mandir School', hq._id, credit.vidya1.data.totalPaise, 'CHEQUE', 'CHQ-204511'));
  if (credit.sharma1?.ok) await must('Sharma pays half by UPI', pay(credit.sharma1.data, 'Sharma Stationers', hq._id, Math.round(credit.sharma1.data.totalPaise / 2), 'UPI', 'UPI-SS-8812'));
  if (credit.saraswati1?.ok) await must('Saraswati School pays 40% by bank transfer', pay(credit.saraswati1.data, 'Saraswati Public School', patna._id, Math.round(credit.saraswati1.data.totalPaise * 0.4), 'BANK_TRANSFER', 'NEFT-SPS-0391'));
  if (credit.xavier1?.ok) await must('St. Xavier pays in full by UPI', pay(credit.xavier1.data, 'St. Xavier Coaching Classes', patna._id, credit.xavier1.data.totalPaise, 'UPI', 'UPI-SXC-77'));
  if (credit.kumar1?.ok) await must('Kumar Xerox pays in cash', pay(credit.kumar1.data, 'Kumar Xerox & Stationery', patna._id, credit.kumar1.data.totalPaise, 'CASH', undefined, sunita));
  if (credit.bansal1?.ok && credit.bansal2?.ok) {
    const one = Math.round(credit.bansal1.data.totalPaise * 0.5);
    const two = credit.bansal2.data.totalPaise;
    await must('Bansal pays with ONE cheque spread over two bills', meena.post('/payments', {
      branchId: hq._id, customerId: C('Bansal Book Depot'), amountPaise: one + two, method: 'CHEQUE', reference: 'CHQ-BBD-6120',
      allocations: [{ invoiceId: credit.bansal1.data._id, amountPaise: one }, { invoiceId: credit.bansal2.data._id, amountPaise: two }],
    }));
  }
  if (credit.singh1?.ok) {
    const bounced = await must('Singh pays by cheque...', pay(credit.singh1.data, 'Singh General Store', ranchi._id, credit.singh1.data.totalPaise, 'CHEQUE', 'CHQ-SGS-3301', vikram));
    if (bounced.ok) await must('  ...the cheque bounces, so the payment is voided (the bill reopens)', owner.post(`/payments/${bounced.data._id}/void`, { reason: 'Cheque returned unpaid by the bank' }));
  }

  section('10. Returns, cancellations and things that must be refused');
  if (credit.vidya1?.ok) {
    const returned = await must('Vidya Mandir returns 25 damaged notebooks (credit worked out proportionally)', owner.post('/sales-returns', {
      invoiceId: credit.vidya1.data._id, reason: 'DEFECTIVE', items: [{ productId: P('Classmate Notebook 172 Pages'), quantity: 25 }],
    }));
    if (returned.ok) {
      const detail = (await owner.get(`/invoices/${credit.vidya1.data._id}`)).data;
      const due = (detail.paidPaise ?? 0) - (detail.totalPaise - (detail.returnedPaise ?? 0));
      if (due > 0) {
        await must('  the school had already paid in full, so the credit is refunded in cash', owner.post('/sales-returns', {
          invoiceId: credit.vidya1.data._id, reason: 'WRONG_ITEM', items: [{ productId: P('Camlin Geometry Box'), quantity: 2 }],
          refund: { method: 'CASH', amountPaise: Math.min(due, rupees(100)) },
        }));
      }
    }
  }
  if (credit.sharma2?.ok) {
    await must('Sharma returns 10 gel pens the customer did not need', owner.post('/sales-returns', {
      invoiceId: credit.sharma2.data._id, reason: 'CUSTOMER_CHANGED_MIND', items: [{ productId: P('Camlin Kokuyo Gel Pen'), quantity: 10 }],
    }));
  }
  if (credit.mistake?.ok) await must('The wrongly raised bill is cancelled (stock goes back)', owner.post(`/invoices/${credit.mistake.data._id}/cancel`, { reason: 'Raised for the wrong customer' }));
  if (credit.sharma1?.ok) await mustRefuse('Cancel a bill that already has a payment', 'An invoice with payments recorded cannot be cancelled directly',
    owner.post(`/invoices/${credit.sharma1.data._id}/cancel`, {}));
  if (credit.sharma1?.ok) await mustRefuse('Collect more than the bill is worth', 'A payment cannot exceed what is owed on the invoice',
    pay(credit.sharma1.data, 'Sharma Stationers', hq._id, credit.sharma1.data.totalPaise * 5, 'CASH', undefined, meena));
  await mustRefuse('Sell more than the shelf holds', 'Stock cannot go negative unless the owner allows it',
    sale(owner, ranchi._id, 'Walk-in customer', [['Fevicol MR 100g', 5000]]));
  await mustRefuse('Sell past a customer\'s credit limit', 'Credit-limit enforcement is on',
    sale(owner, hq._id, 'Anand Book Centre', [['Classmate Notebook 172 Pages', 700]]));
  await mustRefuse('Counter staff give a 25% discount', 'Discounts above the shop cap need an override permission',
    sale(sunita, patna._id, 'Walk-in customer', [['Natraj 621 Pencil', 10, 25]]));
  await mustRefuse('Counter staff open the reports', 'Reports need the reports permission',
    sunita.get('/reports'));
  await mustRefuse('Counter staff look at the staff list', 'Staff management needs its own permission',
    sunita.get('/users'));
  await mustRefuse('Receive more goods than were ordered', 'A delivery cannot exceed what is outstanding on the order',
    anil.post(`/purchase-orders/${po2.data?._id}/receive`, { items: [{ productId: P('Natraj 621 Pencil'), receivedQty: 99999 }] }));

  section('11. Quotes and orders');
  const q1 = await must('Quotation to Saraswati Public School', owner.post('/quotations', {
    branchId: hq._id, customerId: C('Saraswati Public School'),
    items: [{ productId: P('Classmate Notebook 120 Pages'), quantity: 500, discountPercent: 8 }, { productId: P('Natraj 621 Pencil'), quantity: 1000 }],
  }));
  if (q1.ok) {
    await must('  sent', owner.post(`/quotations/${q1.data._id}/send`));
    await must('  accepted by the school', owner.post(`/quotations/${q1.data._id}/accept`));
    const converted = await must('  turned into a sales order', owner.post(`/quotations/${q1.data._id}/convert-to-order`));
    if (converted.ok) {
      await mustRefuse('  converting the same quotation a second time', 'A quotation converts exactly once', owner.post(`/quotations/${q1.data._id}/convert-to-order`));
    }
  }
  const q2 = await must('Quotation to Anand Book Centre (converted straight to an invoice)', owner.post('/quotations', {
    branchId: ranchi._id, customerId: C('Anand Book Centre'), items: [{ productId: P('Classmate Notebook 120 Pages'), quantity: 100 }],
  }));
  if (q2.ok) {
    await owner.post(`/quotations/${q2.data._id}/send`);
    await must('  accepted and invoiced in one go', owner.post(`/quotations/${q2.data._id}/convert-to-invoice`));
  }
  const q3 = await must('Quotation to Singh General Store (left as a draft)', owner.post('/quotations', {
    branchId: ranchi._id, customerId: C('Singh General Store'), items: [{ productId: P('Apsara Platinum Pencil'), quantity: 800 }],
  }));
  void q3;

  const so1 = await must('Sales order from Bansal Book Depot', owner.post('/sales-orders', {
    branchId: hq._id, customerId: C('Bansal Book Depot'),
    items: [{ productId: P('Classmate Long Book 240 Pages'), quantity: 200 }, { productId: P('Camlin Wax Crayons 24'), quantity: 120 }],
  }));
  if (so1.ok) {
    await must('  confirmed', owner.post(`/sales-orders/${so1.data._id}/confirm`));
    await must('  first part delivered and invoiced', owner.post(`/sales-orders/${so1.data._id}/invoice`, { items: [
      { productId: P('Classmate Long Book 240 Pages'), quantity: 120 },
    ] }));
    await must('  second part invoiced later', owner.post(`/sales-orders/${so1.data._id}/invoice`, { items: [
      { productId: P('Classmate Long Book 240 Pages'), quantity: 80 }, { productId: P('Camlin Wax Crayons 24'), quantity: 60 },
    ] }));
  }
  const so2 = await must('Sales order from Maa Durga Kirana Store (still a draft)', owner.post('/sales-orders', {
    branchId: hq._id, customerId: C('Maa Durga Kirana Store'), items: [{ productId: P('Fevikwik 5g'), quantity: 150 }],
  }));
  void so2;
  const so3 = await must('Sales order from Kumar Xerox (cancelled)', owner.post('/sales-orders', {
    branchId: patna._id, customerId: C('Kumar Xerox & Stationery'), items: [{ productId: P('Gum Tape 2 inch'), quantity: 30 }],
  }));
  if (so3.ok) await must('  cancelled', owner.post(`/sales-orders/${so3.data._id}/cancel`));

  credentials.built = true;
  saveCredentials();
  writeFileSync(
    new URL('build-summary.json', DIR),
    JSON.stringify({ ok: log.ok, refused: log.refused, failed: log.failed, refusals: log.refusals, organizationId: credentials.organizationId }, null, 2),
  );

  console.log(`\n  Built: ${log.ok} steps done, ${log.refused} refused as designed, ${log.failed} failed.`);
  console.log('  Sign-in details are in demo/credentials.json (not printed).\n');
}

/* -------------------------------------------------------------------------- */
/* facts                                                                      */
/* -------------------------------------------------------------------------- */

async function facts() {
  const credentials = JSON.parse(readFileSync(CREDENTIALS, 'utf8'));
  const login = await http(null, 'POST', '/auth/login', credentials.owner);
  if (!login.ok) {
    console.error('Could not sign in as the owner.');
    process.exit(1);
  }
  const owner = client(login.data.accessToken);

  const list = async (path) => (await owner.get(`${path}${path.includes('?') ? '&' : '?'}limit=100`)).data ?? [];
  const out = { generatedAt: new Date().toISOString() };

  out.dashboard = (await owner.get('/dashboard')).data;
  out.branches = await list('/branches');
  out.products = await list('/products');
  out.customers = await list('/customers?withBalance=true');
  out.suppliers = await list('/suppliers');
  out.invoices = await list('/invoices');
  out.payments = await list('/payments');
  out.quotations = await list('/quotations');
  out.salesOrders = await list('/sales-orders');
  out.salesReturns = await list('/sales-returns');
  out.purchaseOrders = await list('/purchase-orders');
  out.purchaseReturns = await list('/purchase-returns');
  out.supplierPayments = await list('/supplier-payments');
  out.transfers = await list('/inventory/transfers');
  out.users = await list('/users');
  out.roles = await list('/roles');
  out.notifications = await list('/notifications');
  out.notificationSummary = (await owner.get('/notifications/summary')).data;
  out.audit = (await owner.get('/audit-logs?limit=15')).body;

  // The period reports default to the last 30 days; the demo shop's history is longer.
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const period = `from=${day(-120)}&to=${day(0)}`;
  const run = async (key, query = '') => (await owner.get(`/reports/${key}?${[query, ['sales-summary', 'tax-summary', 'collections', 'purchases-summary'].includes(key) ? period : ''].filter(Boolean).join('&')}`)).data;

  out.reports = {};
  for (const key of ['sales-summary', 'tax-summary', 'collections', 'receivables-aging', 'payables-aging', 'purchases-summary', 'stock-valuation', 'reorder']) {
    out.reports[key] = await run(key, key === 'sales-summary' ? 'groupBy=customer' : key === 'stock-valuation' ? 'groupBy=category' : '');
  }
  out.reportsCustomerSalesProduct = await run('sales-summary', 'groupBy=product');
  out.reportsByMonth = await run('sales-summary', 'groupBy=month');
  out.reportsPurchasesBySupplier = await run('purchases-summary', 'groupBy=supplier');
  out.reportsStockByBranch = await run('stock-valuation', 'groupBy=branch');

  out.customerSummaries = {};
  for (const customer of out.customers.slice(0, 10)) {
    out.customerSummaries[customer.name] = (await owner.get(`/customers/${customer._id}/summary`)).data;
  }
  out.supplierSummaries = {};
  for (const supplier of out.suppliers) {
    out.supplierSummaries[supplier.name] = (await owner.get(`/suppliers/${supplier._id}/summary`)).data;
  }
  const sharma = out.customers.find((c) => c.name.startsWith('Sharma'));
  if (sharma) out.sharmaStatement = (await owner.get(`/customers/${sharma._id}/statement`)).data;
  const natraj = out.suppliers.find((s) => s.name.startsWith('Natraj'));
  if (natraj) out.natrajStatement = (await owner.get(`/suppliers/${natraj._id}/statement`)).data;

  // What a limited member can and cannot see, as evidence for the access demo.
  const staffLogin = credentials.staff.find((s) => s.email.startsWith('sunita'));
  if (staffLogin) {
    const sunitaLogin = await http(null, 'POST', '/auth/login', { email: staffLogin.email, password: credentials.staffPassword });
    const sunita = client(sunitaLogin.data.accessToken);
    const stock = await sunita.get('/inventory/stock?limit=100');
    const product = await sunita.get(`/products/${out.products[0]._id}`);
    out.access = {
      sunitaStockBranches: [...new Set((stock.data ?? []).map((row) => row.branchName ?? row.branchId))],
      sunitaSeesCost: JSON.stringify(product.body).includes('costPricePaise'),
      sunitaReportsStatus: (await sunita.get('/reports')).status,
      sunitaUsersStatus: (await sunita.get('/users')).status,
      sunitaDashboardHasPayables: JSON.stringify((await sunita.get('/dashboard')).body).includes('payables'),
    };
  }

  writeFileSync(FACTS, JSON.stringify(out, null, 2));
  console.log('Wrote demo/facts.json');
}

/* -------------------------------------------------------------------------- */

const [command, ...args] = process.argv.slice(2);
if (command === 'build') {
  const email = args[0];
  if (!email) {
    console.error('Usage: node scripts/demo-owner.mjs build <owner-email> [business name]');
    process.exit(1);
  }
  await build(email, args[1] ?? 'Gupta Traders');
} else if (command === 'facts') {
  await facts();
} else {
  console.error('Usage: node scripts/demo-owner.mjs build <owner-email> [business name] | facts');
  process.exit(1);
}
