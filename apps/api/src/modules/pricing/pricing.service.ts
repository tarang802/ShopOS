import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  formatTierRange,
  resolveTier,
  sortTiers,
  validateTiers,
  type PriceTier,
} from '@shopos/shared';
import { PriceList, Product, ProductPrice } from '../../db/models';
import { AppError } from '../../core/AppError';
import { orgFilter, type TenantContext } from '../../core/tenantContext';
import { recordAudit } from '../../services/auditService';

/**
 * Pricing.
 *
 * The rules themselves live in `@shopos/shared/pricing` as pure functions, so
 * the web app can preview a rate card with exactly the same logic the server
 * uses to decide it. The server result is always the one that counts; the client
 * never sends a price it worked out itself.
 */

export async function listPriceLists(ctx: TenantContext, includeInactive = false) {
  const filter: Record<string, unknown> = { ...orgFilter(ctx) };
  if (!includeInactive) filter.isActive = true;
  return PriceList.find(filter).sort({ displayOrder: 1, name: 1 }).lean();
}

export interface PriceListInput {
  name: string;
  code: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export async function createPriceList(ctx: TenantContext, input: PriceListInput) {
  const code = input.code.trim().toUpperCase();

  const existing = await PriceList.findOne({ ...orgFilter(ctx), code }).lean();
  if (existing) throw AppError.duplicate(`A rate list with code ${code} already exists`);

  const [priceList] = await PriceList.create([{ ...orgFilter(ctx), ...input, code }]);
  if (!priceList) throw AppError.internal('Could not create the rate list');

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.PRICE_LIST_CREATED,
    entityType: 'PriceList',
    entityId: priceList._id,
    entityLabel: priceList.name,
    after: { name: priceList.name, code: priceList.code },
  });

  return priceList.toObject();
}

export async function updatePriceList(
  ctx: TenantContext,
  priceListId: Types.ObjectId,
  input: Partial<PriceListInput>,
) {
  const priceList = await PriceList.findOne({ ...orgFilter(ctx), _id: priceListId });
  if (!priceList) throw AppError.notFound('Rate list');

  // The default list is what the counter falls back to, so it must stay usable.
  if (input.isActive === false && priceList.isDefault) {
    throw AppError.businessRule('The default rate list cannot be switched off');
  }

  const before = priceList.toObject();
  Object.assign(priceList, input);
  await priceList.save();

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.PRICE_LIST_UPDATED,
    entityType: 'PriceList',
    entityId: priceList._id,
    entityLabel: priceList.name,
    before: { name: before.name, isActive: before.isActive },
    after: { name: priceList.name, isActive: priceList.isActive },
  });

  return priceList.toObject();
}

/**
 * Save a complete rate card for one product under one rate list.
 *
 * The whole card is replaced in a single write, never patched slab by slab. That
 * is what guarantees the stored card is always internally consistent: there is
 * no moment at which the database holds half of an edit, so overlapping slabs
 * cannot exist even if the process dies mid-request.
 */
export async function setProductPrice(
  ctx: TenantContext,
  productId: Types.ObjectId,
  priceListId: Types.ObjectId,
  tiers: PriceTier[],
) {
  const [product, priceList] = await Promise.all([
    Product.findOne({ ...orgFilter(ctx), _id: productId }).lean(),
    PriceList.findOne({ ...orgFilter(ctx), _id: priceListId }).lean(),
  ]);

  if (!product) throw AppError.notFound('Product');
  if (!priceList) throw AppError.notFound('Rate list');
  if (!priceList.isActive) {
    throw AppError.businessRule('This rate list is switched off. Turn it on before setting rates');
  }

  const validation = validateTiers(tiers);
  if (!validation.valid) {
    throw new AppError(
      422,
      ERROR_CODES.OVERLAPPING_PRICE_TIERS,
      'The quantity slabs are not valid',
      validation.issues.map((issue) => ({
        field: issue.index >= 0 ? `tiers.${issue.index}` : 'tiers',
        message: issue.message,
      })),
    );
  }

  const normalized = sortTiers(tiers);
  const existing = await ProductPrice.findOne({ ...orgFilter(ctx), productId, priceListId });

  const isUpdate = Boolean(existing);
  const before = existing ? sortTiers(existing.tiers) : null;

  const saved = await ProductPrice.findOneAndUpdate(
    { ...orgFilter(ctx), productId, priceListId },
    {
      $set: {
        tiers: normalized,
        isActive: true,
        effectiveFrom: new Date(),
        updatedBy: ctx.userId,
      },
      $setOnInsert: { createdBy: ctx.userId },
    },
    { returnDocument: 'after', upsert: true },
  ).lean();

  await recordAudit(ctx, {
    action: isUpdate ? AUDIT_ACTIONS.PRICE_UPDATED : AUDIT_ACTIONS.PRICE_CREATED,
    entityType: 'ProductPrice',
    entityId: saved?._id,
    entityLabel: `${product.name} - ${priceList.name}`,
    // Slabs are recorded in the readable form an owner would say out loud, so
    // the audit screen shows "1 - 9: 500 -> 480" rather than raw objects.
    ...(before ? { before: { tiers: before.map(describeTier) } } : {}),
    after: { tiers: normalized.map(describeTier) },
  });

  return saved;
}

function describeTier(tier: PriceTier) {
  return { range: formatTierRange(tier), pricePaise: tier.pricePaise };
}

export async function removeProductPrice(
  ctx: TenantContext,
  productId: Types.ObjectId,
  priceListId: Types.ObjectId,
) {
  const price = await ProductPrice.findOne({ ...orgFilter(ctx), productId, priceListId });
  if (!price) throw AppError.notFound('Rate');

  await ProductPrice.deleteOne({ ...orgFilter(ctx), productId, priceListId });

  await recordAudit(ctx, {
    action: AUDIT_ACTIONS.PRICE_DELETED,
    entityType: 'ProductPrice',
    entityId: price._id,
    before: { tiers: sortTiers(price.tiers).map(describeTier) },
  });

  return { deleted: true };
}

export interface ResolvePriceInput {
  productId: Types.ObjectId;
  priceListId?: Types.ObjectId;
  quantity: number;
}

/**
 * The pricing engine, as an API.
 *
 * Given a product, a rate list and a quantity, return the one rate that applies
 * and the slab it came from. When no slab covers the quantity the call fails
 * with a clear reason - it never quietly falls back to another rate. A confident
 * wrong price on a bill is far worse than an honest refusal to quote.
 */
export async function resolvePrice(ctx: TenantContext, input: ResolvePriceInput) {
  const [resolved] = await resolvePrices(ctx, [input]);
  return resolved!;
}

/**
 * Resolve many lines at once.
 *
 * A bill with thirty lines used to cost four queries per line, run one after the
 * other. Here every product, rate list and rate card involved is read in three
 * queries and the slab for each line is picked in memory. It is the only
 * implementation: `resolvePrice` calls it with one line, so a single quote and a
 * whole invoice can never disagree about the rules.
 */
export async function resolvePrices(ctx: TenantContext, inputs: ResolvePriceInput[]) {
  if (inputs.length === 0) return [];

  const needsDefault = inputs.some((input) => !input.priceListId);
  const defaultListId = needsDefault
    ? (await PriceList.findOne({ ...orgFilter(ctx), isDefault: true, isActive: true }).lean())?._id
    : undefined;

  const listIdFor = (input: ResolvePriceInput): Types.ObjectId => {
    const id = input.priceListId ?? defaultListId;
    if (!id) throw AppError.badRequest('No rate list selected and no default is set');
    return id;
  };

  const productIds = [...new Set(inputs.map((input) => input.productId.toString()))].map(
    (id) => new Types.ObjectId(id),
  );
  const priceListIds = [...new Set(inputs.map((input) => listIdFor(input).toString()))].map(
    (id) => new Types.ObjectId(id),
  );

  const [products, priceLists, prices] = await Promise.all([
    Product.find({ ...orgFilter(ctx), _id: { $in: productIds } }).lean(),
    PriceList.find({ ...orgFilter(ctx), _id: { $in: priceListIds } }).lean(),
    ProductPrice.find({
      ...orgFilter(ctx),
      productId: { $in: productIds },
      priceListId: { $in: priceListIds },
      isActive: true,
    }).lean(),
  ]);

  const productById = new Map(products.map((product) => [product._id.toString(), product]));
  const listById = new Map(priceLists.map((list) => [list._id.toString(), list]));
  const priceByKey = new Map(
    prices.map((price) => [`${price.productId.toString()}:${price.priceListId.toString()}`, price]),
  );

  return inputs.map((input) => {
    const priceListId = listIdFor(input);
    const product = productById.get(input.productId.toString());
    const priceList = listById.get(priceListId.toString());

    if (!product) throw AppError.notFound('Product');
    if (!priceList) throw AppError.notFound('Rate list');
    if (!priceList.isActive) {
      throw new AppError(
        422,
        ERROR_CODES.PRICE_NOT_FOUND,
        `The ${priceList.name} rate list is switched off`,
      );
    }

    const price = priceByKey.get(`${input.productId.toString()}:${priceListId.toString()}`);
    if (!price) {
      throw new AppError(
        422,
        ERROR_CODES.PRICE_NOT_FOUND,
        `${product.name} has no ${priceList.name} rate set yet`,
      );
    }

    const tier = resolveTier(price.tiers, input.quantity);
    if (!tier) {
      throw new AppError(
        422,
        ERROR_CODES.PRICE_NOT_FOUND,
        `No ${priceList.name} slab covers a quantity of ${input.quantity}`,
      );
    }

    return {
      productId: product._id.toString(),
      productName: product.name,
      sku: product.sku,
      unitSymbol: product.unitSymbol,
      taxRatePercent: product.taxRatePercent,
      priceListId: priceList._id.toString(),
      priceListName: priceList.name,
      quantity: input.quantity,
      unitPricePaise: tier.pricePaise,
      // Rounded to whole paise, because a line total that is not a whole number of
      // paise cannot be paid and cannot be summed exactly.
      lineTotalPaise: Math.round(tier.pricePaise * input.quantity),
      appliedTier: { range: formatTierRange(tier), ...tier },
      allTiers: sortTiers(price.tiers),
    };
  });
}

/** The most recently changed rates, for the dashboard activity panel. */
export async function recentPriceUpdates(ctx: TenantContext, limit = 10) {
  const prices = await ProductPrice.find({ ...orgFilter(ctx) })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  // Two scoped lookups rather than `populate`, for the same reason as elsewhere:
  // populate resolves by _id and produces an unscoped query.
  const [products, lists] = await Promise.all([
    Product.find({ ...orgFilter(ctx), _id: { $in: prices.map((price) => price.productId) } })
      .select('name sku')
      .lean(),
    PriceList.find({ ...orgFilter(ctx), _id: { $in: prices.map((price) => price.priceListId) } })
      .select('name')
      .lean(),
  ]);
  const productById = new Map(products.map((product) => [product._id.toString(), product]));
  const listById = new Map(lists.map((list) => [list._id.toString(), list]));

  return prices.flatMap((price) => {
    const product = productById.get(price.productId.toString());
    const list = listById.get(price.priceListId.toString());
    if (!product || !list) return [];

    return [
      {
        productName: product.name,
        sku: product.sku,
        priceListName: list.name,
        tiers: sortTiers(price.tiers),
        updatedAt: price.updatedAt,
      },
    ];
  });
}
