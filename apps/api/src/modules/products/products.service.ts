import { Types } from 'mongoose';
import { AUDIT_ACTIONS, toSkip, type PaginationQuery } from '@shopos/shared';
import {
  Branch,
  Brand,
  Category,
  InventoryBalance,
  PriceList,
  Product,
  ProductPrice,
  Unit,
  type IProduct,
} from '../../db/models';
import { AppError } from '../../core/AppError';
import { safeSearchRegex, type Filter } from '../../core/listQuery';
import { orgFilter, type TenantContext } from '../../core/tenantContext';
import { diffFields, recordAudit } from '../../services/auditService';
import { nextSku } from '../../services/counterService';

/**
 * The product catalogue - and the search that is the whole point of ShopOS.
 *
 * A staff member types "Natraj" at the counter and must see the item, its rates
 * and its stock before the customer finishes asking. Everything here is built
 * around that: search runs on the server against indexes, never by shipping the
 * catalogue to the browser and filtering it there.
 */

export interface ProductInput {
  name: string;
  sku?: string;
  description?: string;
  brandId?: string;
  categoryId?: string;
  unitId: string;
  barcodes?: { code: string; type?: string }[];
  images?: { url: string; publicId: string; isPrimary?: boolean }[];
  taxRatePercent?: number;
  reorderLevel?: number;
}

/**
 * Resolve the brand, category and unit a product points at, and confirm every
 * one of them belongs to the caller's business.
 *
 * This is the check that stops a client pasting in a brand id belonging to
 * another shop. The ids are valid and well-formed; only the tenant filter makes
 * them wrong.
 */
async function resolveReferences(ctx: TenantContext, input: ProductInput | Partial<ProductInput>) {
  const result: Partial<IProduct> = {};

  if (input.unitId) {
    const unit = await Unit.findOne({ ...orgFilter(ctx), _id: input.unitId }).lean();
    if (!unit) throw AppError.badRequest('Select a valid unit');
    result.unitId = unit._id;
    result.unitName = unit.name;
    result.unitSymbol = unit.symbol;
  }

  if (input.brandId) {
    const brand = await Brand.findOne({ ...orgFilter(ctx), _id: input.brandId }).lean();
    if (!brand) throw AppError.badRequest('Select a valid brand');
    result.brandId = brand._id;
    result.brandName = brand.name;
  }

  if (input.categoryId) {
    const category = await Category.findOne({ ...orgFilter(ctx), _id: input.categoryId }).lean();
    if (!category) throw AppError.badRequest('Select a valid category');
    result.categoryId = category._id;
    result.categoryName = category.name;
  }

  return result;
}

export interface ProductListFilters {
  categoryId?: string;
  brandId?: string;
  status?: 'active' | 'archived' | 'all';
}

/**
 * Search the catalogue.
 *
 * Three strategies, in the order a person would expect:
 *
 *   1. An exact item code or barcode wins outright. Scanning a barcode or typing
 *      a known SKU should return that one product, not a list.
 *   2. A full-text match on name, code, brand and category. This is what handles
 *      "natraj pencil" - two words, either order.
 *   3. A pattern match, used when the text index finds nothing. Text search
 *      matches whole words, so a half-typed "penc" would otherwise return
 *      nothing at all, and staff type half words constantly.
 *
 * All three run against MongoDB. None of them loads the catalogue into memory.
 */
export async function listProducts(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: ProductListFilters,
) {
  const base: Filter = { ...orgFilter(ctx) };

  if (filters.status !== 'all') {
    base.isActive = filters.status !== 'archived';
  }
  if (filters.categoryId) base.categoryId = new Types.ObjectId(filters.categoryId);
  if (filters.brandId) base.brandId = new Types.ObjectId(filters.brandId);

  const term = query.search?.trim();

  if (!term) {
    const [items, total] = await Promise.all([
      Product.find(base)
        .sort({ name: 1 })
        .skip(toSkip(query.page, query.limit))
        .limit(query.limit)
        .lean(),
      Product.countDocuments(base),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  // 1. Exact code match.
  const codeFilter: Filter = {
    ...base,
    $or: [{ sku: term.toUpperCase() }, { 'barcodes.code': term }],
  };
  const exact = await Product.find(codeFilter).limit(query.limit).lean();
  if (exact.length > 0) {
    return { items: exact, total: exact.length, page: 1, limit: query.limit };
  }

  // 2. Full-text match. Sorted by relevance, so "Natraj" ranks the pencil above
  //    a product that merely mentions it in its description.
  if (term.length >= 3) {
    const textFilter: Filter = { ...base, $text: { $search: term } };
    const [items, total] = await Promise.all([
      Product.find(textFilter, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .skip(toSkip(query.page, query.limit))
        .limit(query.limit)
        .lean(),
      Product.countDocuments(textFilter),
    ]);
    if (items.length > 0) return { items, total, page: query.page, limit: query.limit };
  }

  // 3. Partial-word fallback.
  const pattern = safeSearchRegex(term);
  const regexFilter: Filter = {
    ...base,
    $or: [{ name: pattern }, { sku: pattern }, { brandName: pattern }],
  };
  const [items, total] = await Promise.all([
    Product.find(regexFilter)
      .sort({ name: 1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
    Product.countDocuments(regexFilter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

/**
 * Everything about one product on a single screen: rates under every price list,
 * and stock at every branch.
 *
 * This is the screen that replaces the phone call to the owner, so it answers
 * every question at once rather than making staff click through tabs.
 */
export async function getProductDetail(ctx: TenantContext, productId: Types.ObjectId) {
  const product = await Product.findOne({ ...orgFilter(ctx), _id: productId }).lean();
  if (!product) throw AppError.notFound('Product');

  const [priceLists, prices, balances] = await Promise.all([
    PriceList.find({ ...orgFilter(ctx), isActive: true }).sort({ displayOrder: 1 }).lean(),
    ProductPrice.find({ ...orgFilter(ctx), productId, isActive: true }).lean(),
    InventoryBalance.find({ ...orgFilter(ctx), productId }).lean(),
  ]);

  /**
   * Branch names are fetched with their own tenant-scoped query rather than with
   * `populate`. Populate resolves by _id alone, which produces a query with no
   * organizationId in it - the tenant guard rejects those on principle, because
   * an id-only lookup is exactly the shape a cross-tenant read takes.
   */
  const branches = await Branch.find({
    ...orgFilter(ctx),
    _id: { $in: balances.map((balance) => balance.branchId) },
  })
    .select('name code')
    .lean();
  const branchById = new Map(branches.map((branch) => [branch._id.toString(), branch]));

  const priceByList = new Map(prices.map((price) => [price.priceListId.toString(), price]));

  // A branch manager must not learn what other branches hold, so the stock rows
  // are filtered to the branches this person works in.
  const visibleBalances = ctx.allBranches
    ? balances
    : balances.filter((balance) => ctx.branchIds.some((id) => id.equals(balance.branchId)));

  return {
    product,
    prices: priceLists.map((list) => {
      const price = priceByList.get(list._id.toString());
      return {
        priceListId: list._id.toString(),
        priceListName: list.name,
        priceListCode: list.code,
        isDefault: list.isDefault,
        tiers: price?.tiers ?? [],
        updatedAt: price?.updatedAt ?? null,
      };
    }),
    stock: visibleBalances.flatMap((balance) => {
      const branch = branchById.get(balance.branchId.toString());
      if (!branch) return [];
      return [
        {
          branchId: branch._id.toString(),
          branchName: branch.name,
          quantity: balance.quantity,
          lastMovementAt: balance.lastMovementAt ?? null,
        },
      ];
    }),
    totalStock: visibleBalances.reduce((sum, balance) => sum + balance.quantity, 0),
  };
}

export async function createProduct(ctx: TenantContext, input: ProductInput) {
  const references = await resolveReferences(ctx, input);
  if (!references.unitId) throw AppError.badRequest('Select a valid unit');

  // An owner who does not run their own numbering gets one generated, so nothing
  // blocks them from simply typing a product name and saving.
  const sku = input.sku?.trim().toUpperCase() || (await nextSku(ctx.organizationId));

  const clash = await Product.findOne({ ...orgFilter(ctx), sku }).lean();
  if (clash) throw AppError.duplicate(`Item code ${sku} is already used by another product`);

  if (input.barcodes?.length) {
    const codes = input.barcodes.map((barcode) => barcode.code);
    const barcodeClash = await Product.findOne({
      ...orgFilter(ctx),
      'barcodes.code': { $in: codes },
    }).lean();
    if (barcodeClash) {
      throw AppError.duplicate(`Barcode already belongs to ${barcodeClash.name}`);
    }
  }

  const [product] = await Product.create([
    {
      ...orgFilter(ctx),
      name: input.name.trim(),
      sku,
      description: input.description,
      barcodes: input.barcodes ?? [],
      images: input.images ?? [],
      taxRatePercent: input.taxRatePercent ?? 0,
      reorderLevel: input.reorderLevel ?? 0,
      ...references,
      createdBy: ctx.userId,
    },
  ]);
  if (!product) throw AppError.internal('Could not create the product');

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.PRODUCT_CREATED,
    entityType: 'Product',
    entityId: product._id,
    entityLabel: product.name,
    after: { name: product.name, sku: product.sku, brandName: product.brandName },
  });

  return product.toObject();
}

export async function updateProduct(
  ctx: TenantContext,
  productId: Types.ObjectId,
  input: Partial<ProductInput>,
) {
  const product = await Product.findOne({ ...orgFilter(ctx), _id: productId });
  if (!product) throw AppError.notFound('Product');

  const references = await resolveReferences(ctx, input);

  if (input.sku) {
    const sku = input.sku.trim().toUpperCase();
    if (sku !== product.sku) {
      const clash = await Product.findOne({ ...orgFilter(ctx), sku }).lean();
      if (clash) throw AppError.duplicate(`Item code ${sku} is already in use`);
      product.sku = sku;
    }
  }

  if (input.barcodes) {
    const codes = input.barcodes.map((barcode) => barcode.code);
    if (codes.length > 0) {
      const barcodeClash = await Product.findOne({
        ...orgFilter(ctx),
        _id: { $ne: productId },
        'barcodes.code': { $in: codes },
      }).lean();
      if (barcodeClash) {
        throw AppError.duplicate(`Barcode already belongs to ${barcodeClash.name}`);
      }
    }
  }

  const before = product.toObject();

  const { sku: _ignoredSku, brandId: _b, categoryId: _c, unitId: _u, ...rest } = input;
  Object.assign(product, rest, references);
  product.updatedBy = ctx.userId;
  await product.save();

  const changes = diffFields(before, { ...rest, ...references } as Record<string, unknown>);

  if (changes) {
    await recordAudit(ctx, {
      action: AUDIT_ACTIONS.PRODUCT_UPDATED,
      entityType: 'Product',
      entityId: product._id,
      entityLabel: product.name,
      ...changes,
    });
  }

  return product.toObject();
}

/**
 * Archive rather than delete.
 *
 * Every stock movement and, later, every invoice line points at this document.
 * Deleting it would leave the history unreadable - a ledger row for a product
 * that no longer exists explains nothing. Archiving hides it from new work and
 * keeps the past intact.
 */
export async function setProductActive(
  ctx: TenantContext,
  productId: Types.ObjectId,
  isActive: boolean,
) {
  const product = await Product.findOne({ ...orgFilter(ctx), _id: productId });
  if (!product) throw AppError.notFound('Product');

  product.isActive = isActive;
  product.updatedBy = ctx.userId;
  await product.save();

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.PRODUCT_ARCHIVED,
    entityType: 'Product',
    entityId: product._id,
    entityLabel: product.name,
    before: { isActive: !isActive },
    after: { isActive },
  });

  return product.toObject();
}
