import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import {
  ADJUSTMENT_REASONS,
  AUTH_PROVIDERS,
  DEFAULT_PRICE_LIST_CODES,
  MEMBERSHIP_STATUSES,
  SYSTEM_ROLES,
  rupeesToPaise,
} from '@shopos/shared';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../core/logger';
import {
  Branch,
  Brand,
  Category,
  Customer,
  Membership,
  Organization,
  PriceList,
  Product,
  ProductPrice,
  Role,
  Supplier,
  Unit,
  User,
} from '../db/models';
import { bootstrapOrganization } from '../services/organizationBootstrap';
import { applyMovement } from '../services/inventoryService';
import type { TenantContext } from '../core/tenantContext';

/**
 * Demo data: a stationery wholesaler with three branches.
 *
 * WHY seed at all: an empty ERP shows nothing. Rate slabs, branch-wise stock and
 * the movement ledger only make sense once there is something in them, and a
 * fresh signup cannot show any of it. This gives a working shop to click through
 * on the first run.
 *
 * Safe to run repeatedly: it removes and rebuilds only its own demo business.
 */

const DEMO_EMAIL = 'owner@guptatraders.test';
const DEMO_STAFF_EMAIL = 'sunita@guptatraders.test';
const DEMO_PASSWORD = 'shopos-demo-2026';
const DEMO_SLUG = 'gupta-traders-demo';

const CATALOGUE = [
  { name: 'Natraj 621 Pencil', brand: 'Natraj', category: 'Pencils', unit: 'Piece',
    retail: [ [1, 9, 5], [10, 49, 4.8], [50, 99, 4.5], [100, null, 4.2] ],
    wholesale: [ [1, 49, 4.7], [50, 199, 4.4], [200, null, 4.1] ],
    stock: [1200, 300, 850], reorder: 200 },
  { name: 'Apsara Platinum Pencil', brand: 'Apsara', category: 'Pencils', unit: 'Piece',
    retail: [ [1, 9, 6], [10, 99, 5.75], [100, null, 5.4] ],
    wholesale: [ [1, 99, 5.3], [100, null, 5] ],
    stock: [640, 180, 220], reorder: 150 },
  { name: 'Classmate Notebook 172 Pages', brand: 'Classmate', category: 'Notebooks', unit: 'Piece',
    retail: [ [1, 5, 45], [6, 23, 42], [24, null, 39] ],
    wholesale: [ [1, 23, 38], [24, null, 35.5] ],
    stock: [420, 260, 95], reorder: 100 },
  { name: 'Camlin Geometry Box', brand: 'Camlin', category: 'Instruments', unit: 'Piece',
    retail: [ [1, 4, 130], [5, 19, 124], [20, null, 118] ],
    wholesale: [ [1, 19, 115], [20, null, 108] ],
    stock: [85, 40, 12], reorder: 25 },
  { name: 'Reynolds 045 Ball Pen', brand: 'Reynolds', category: 'Pens', unit: 'Piece',
    retail: [ [1, 9, 10], [10, 99, 9.5], [100, null, 9] ],
    wholesale: [ [1, 99, 8.8], [100, 499, 8.4], [500, null, 8] ],
    stock: [2400, 900, 1500], reorder: 500 },
  { name: 'Fevicol MR 100g', brand: 'Fevicol', category: 'Adhesives', unit: 'Piece',
    retail: [ [1, 11, 42], [12, null, 39] ],
    wholesale: [ [1, null, 36] ],
    stock: [140, 55, 8], reorder: 30 },
  { name: 'A4 Copier Paper 500 Sheets', brand: 'JK Paper', category: 'Paper', unit: 'Packet',
    retail: [ [1, 4, 340], [5, 19, 325], [20, null, 310] ],
    wholesale: [ [1, 19, 302], [20, null, 288] ],
    stock: [60, 35, 18], reorder: 20 },
  { name: 'Stapler Pins 24/6', brand: 'Kangaro', category: 'Office Supplies', unit: 'Box',
    retail: [ [1, 9, 22], [10, null, 20] ],
    wholesale: [ [1, null, 18.5] ],
    stock: [310, 120, 240], reorder: 60 },
] as const;

const BRANCHES = [
  { name: 'Bhagalpur', code: 'BGP', city: 'Bhagalpur' },
  { name: 'Patna', code: 'PAT', city: 'Patna' },
  { name: 'Ranchi', code: 'RNC', city: 'Ranchi' },
];

function tiersFrom(rows: readonly (readonly [number, number | null, number])[]) {
  return rows.map(([min, max, rupees]) => ({
    minQuantity: min,
    maxQuantity: max,
    pricePaise: rupeesToPaise(rupees),
  }));
}

async function wipeExistingDemo(): Promise<void> {
  // The demo accounts are removed first and unconditionally. A previous run that
  // failed part-way can leave the users behind without the business, and an
  // early return on "no organization" would then collide on the unique email.
  await User.deleteMany({ email: { $in: [DEMO_EMAIL, DEMO_STAFF_EMAIL] } });

  const existing = await Organization.findOne({ slug: DEMO_SLUG }).lean();
  if (!existing) return;

  const organizationId = existing._id;
  logger.info('Removing the previous demo business');

  // Collections are cleared directly rather than through the services, because
  // the services deliberately refuse to delete business history.
  //
  // Every collection is swept rather than a hand-kept list: a list silently goes
  // stale each time a module adds a collection, and the orphaned documents left
  // behind then skew every figure on the dashboard after a reseed. A collection
  // with no organizationId simply matches nothing.
  const keep = new Set(['organizations', 'users', 'migrations']);
  const existingCollections = await mongoose.connection.db!.listCollections().toArray();

  for (const { name } of existingCollections) {
    if (keep.has(name) || name.startsWith('system.')) continue;
    await mongoose.connection.collection(name).deleteMany({ organizationId });
  }
  await Organization.deleteOne({ _id: organizationId });
}

async function seed(): Promise<void> {
  await connectDatabase();
  await wipeExistingDemo();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const [owner] = await User.create([
    {
      name: 'Ramesh Gupta',
      email: DEMO_EMAIL,
      passwordHash,
      authProviders: [AUTH_PROVIDERS.PASSWORD],
      emailVerifiedAt: new Date(),
    },
  ]);
  if (!owner) throw new Error('Could not create the demo owner');

  const [organization] = await Organization.create([
    {
      name: 'Gupta Traders',
      slug: DEMO_SLUG,
      businessType: 'Stationery Wholesale',
      city: 'Bhagalpur',
      state: 'Bihar',
      phone: '9876543210',
      email: DEMO_EMAIL,
      createdBy: owner._id,
    },
  ]);
  if (!organization) throw new Error('Could not create the demo business');

  const bootstrap = await bootstrapOrganization(
    organization._id,
    owner._id,
    { branchName: BRANCHES[0]!.name, city: 'Bhagalpur' },
    undefined,
  );

  const organizationId = organization._id;
  const orgScope = { organizationId };

  // The remaining branches. The first was created by the bootstrap.
  const extraBranches = await Branch.create(
    BRANCHES.slice(1).map((branch) => ({ ...orgScope, ...branch, isMain: false })),
  );
  const branchIds = [bootstrap.branchId, ...extraBranches.map((branch) => branch._id)];

  const ownerRole = await Role.findOne({ ...orgScope, code: SYSTEM_ROLES.OWNER }).lean();
  const membership = await Membership.findOne({ ...orgScope, userId: owner._id }).lean();
  if (!ownerRole || !membership) throw new Error('Bootstrap did not produce an owner');

  // A tenant context standing in for the owner, so seeding writes through the
  // same services the application uses - including the stock ledger.
  const ctx: TenantContext = {
    userId: owner._id,
    userName: owner.name,
    organizationId,
    membershipId: membership._id,
    roleId: ownerRole._id,
    roleName: ownerRole.name,
    permissions: new Set(ownerRole.permissions),
    allBranches: true,
    branchIds: [],
  };

  const brandNames = [...new Set(CATALOGUE.map((item) => item.brand))];
  const categoryNames = [...new Set(CATALOGUE.map((item) => item.category))];

  const brands = await Brand.create(brandNames.map((name) => ({ ...orgScope, name })));
  const categories = await Category.create(categoryNames.map((name) => ({ ...orgScope, name })));
  const units = await Unit.find(orgScope).lean();

  const brandByName = new Map(brands.map((brand) => [brand.name, brand]));
  const categoryByName = new Map(categories.map((category) => [category.name, category]));
  const unitByName = new Map(units.map((unit) => [unit.name, unit]));

  const priceLists = await PriceList.find(orgScope).lean();
  const retail = priceLists.find((list) => list.code === DEFAULT_PRICE_LIST_CODES.RETAIL)!;
  const wholesale = priceLists.find((list) => list.code === DEFAULT_PRICE_LIST_CODES.WHOLESALE)!;

  let sequence = 1;
  for (const item of CATALOGUE) {
    const brand = brandByName.get(item.brand)!;
    const category = categoryByName.get(item.category)!;
    const unit = unitByName.get(item.unit)!;

    const [product] = await Product.create([
      {
        ...orgScope,
        name: item.name,
        sku: `SKU${String(sequence).padStart(5, '0')}`,
        brandId: brand._id,
        brandName: brand.name,
        categoryId: category._id,
        categoryName: category.name,
        unitId: unit._id,
        unitName: unit.name,
        unitSymbol: unit.symbol,
        taxRatePercent: 12,
        reorderLevel: item.reorder,
        // Cost sits at about 82% of the best wholesale rate: a believable
        // margin for stationery, so the reports have something to show.
        costPricePaise: Math.round(tiersFrom(item.wholesale).at(-1)!.pricePaise * 0.82),
        createdBy: owner._id,
      },
    ]);
    if (!product) throw new Error(`Could not create ${item.name}`);
    sequence += 1;

    await ProductPrice.create([
      {
        ...orgScope,
        productId: product._id,
        priceListId: retail._id,
        tiers: tiersFrom(item.retail),
        createdBy: owner._id,
      },
      {
        ...orgScope,
        productId: product._id,
        priceListId: wholesale._id,
        tiers: tiersFrom(item.wholesale),
        createdBy: owner._id,
      },
    ]);

    // Opening stock written through the real inventory service, so the ledger
    // and the balances agree exactly as they would in normal use.
    for (const [index, quantity] of item.stock.entries()) {
      const branchId = branchIds[index];
      if (!branchId || quantity <= 0) continue;

      await applyMovement(
        ctx,
        {
          branchId,
          productId: product._id,
          type: 'OPENING_STOCK',
          quantity,
          reason: ADJUSTMENT_REASONS.PHYSICAL_COUNT,
          referenceType: 'SEED',
        },
        { allowNegative: false },
      );
    }
  }

  // A second staff member, branch-scoped, to show what a limited login sees.
  const salesRole = await Role.findOne({ ...orgScope, code: SYSTEM_ROLES.SALES_STAFF }).lean();
  if (salesRole) {
    const [staff] = await User.create([
      {
        name: 'Sunita Kumari',
        email: DEMO_STAFF_EMAIL,
        passwordHash,
        authProviders: [AUTH_PROVIDERS.PASSWORD],
        emailVerifiedAt: new Date(),
      },
    ]);
    if (staff) {
      await Membership.create([
        {
          ...orgScope,
          userId: staff._id,
          roleId: salesRole._id,
          allBranches: false,
          branchIds: [branchIds[1] as Types.ObjectId],
          status: MEMBERSHIP_STATUSES.ACTIVE,
          invitedBy: owner._id,
          joinedAt: new Date(),
        },
      ]);
    }
  }

  const retailListId = retail._id;
  await Customer.create([
    { ...orgScope, name: 'Bansal Book Depot', phone: '9811100001', city: 'Bhagalpur', defaultPriceListId: wholesale._id, creditDays: 15, creditLimitPaise: rupeesToPaise(50000) },
    { ...orgScope, name: 'Sharma Stationers', phone: '9811100002', city: 'Patna', defaultPriceListId: wholesale._id, creditDays: 30, creditLimitPaise: rupeesToPaise(100000) },
    { ...orgScope, name: 'Vidya Mandir School', phone: '9811100003', city: 'Bhagalpur', defaultPriceListId: wholesale._id, creditDays: 45, creditLimitPaise: rupeesToPaise(75000) },
    { ...orgScope, name: 'Maa Durga Kirana Store', phone: '9811100004', city: 'Ranchi', defaultPriceListId: retailListId },
  ]);

  await Supplier.create([
    { ...orgScope, name: 'Rajesh Paper Traders', phone: '9800011122', city: 'Delhi', state: 'Delhi', creditDays: 30 },
    { ...orgScope, name: 'Natraj Distributors', phone: '9800011133', city: 'Kolkata', state: 'West Bengal', creditDays: 15 },
    { ...orgScope, name: 'Camlin Wholesale Depot', phone: '9800011144', city: 'Mumbai', state: 'Maharashtra', creditDays: 45 },
  ]);

  logger.info(
    {
      business: organization.name,
      branches: branchIds.length,
      products: CATALOGUE.length,
    },
    'Demo data ready',
  );

  console.log(`
  ---------------------------------------------------------------
  ShopOS demo data is ready.

  Owner login       ${DEMO_EMAIL}
  Password          ${DEMO_PASSWORD}

  Sales staff       ${DEMO_STAFF_EMAIL}   (Patna branch only)
  Password          ${DEMO_PASSWORD}

  Try searching for "Natraj" once you are signed in.
  ---------------------------------------------------------------
  `);

  await disconnectDatabase();
}

seed().catch(async (error) => {
  logger.fatal({ err: error }, 'Seeding failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
