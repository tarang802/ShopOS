import { Types, type PipelineStage } from 'mongoose';
import {
  ADJUSTMENT_REASONS,
  AUDIT_ACTIONS,
  INVENTORY_TRANSACTION_TYPES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
  PERMISSIONS,
  STOCK_TRANSFER_STATUSES,
  toSkip,
  type AdjustmentReason,
  type PaginationQuery,
} from '@shopos/shared';
import {
  Branch,
  InventoryBalance,
  InventoryTransaction,
  Organization,
  Product,
  StockAdjustment,
  StockTransfer,
} from '../../db/models';
import { AppError } from '../../core/AppError';
import { safeSearchRegex } from '../../core/listQuery';
import {
  assertBranchAccess,
  orgFilter,
  type TenantContext,
} from '../../core/tenantContext';
import { withTransaction } from '../../db/transaction';
import { applyCountCorrection, applyMovement, getStockPolicy } from '../../services/inventoryService';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';
import { notify } from '../../services/notificationService';

/**
 * Stock operations: what is on hand, what moved, and the documents that moved it.
 */

/** Branches this request may see. Used to scope every stock query. */
function visibleBranchFilter(ctx: TenantContext, requestedBranchId?: Types.ObjectId) {
  if (requestedBranchId) {
    assertBranchAccess(ctx, requestedBranchId);
    return { branchId: requestedBranchId };
  }
  if (ctx.allBranches) return {};
  return { branchId: { $in: ctx.branchIds } };
}

export interface StockListFilters {
  branchId?: string;
  /** Only products at or below their reorder level. */
  lowStockOnly?: boolean;
}

/**
 * The stock register: every product with its quantity at the chosen branch.
 *
 * Written as an aggregation because the answer joins two collections and must be
 * paged in the database. Note the `$match` on organizationId as the first stage -
 * the tenant guard cannot see inside a pipeline, so tenant scoping in an
 * aggregation is the author's responsibility and always comes first.
 */
export async function listStock(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: StockListFilters,
) {
  const branchId = filters.branchId ? new Types.ObjectId(filters.branchId) : undefined;
  const branchScope = visibleBranchFilter(ctx, branchId);

  const match: Record<string, unknown> = { ...orgFilter(ctx), ...branchScope };

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $lookup: {
        from: Product.collection.name,
        localField: 'productId',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
    { $match: { 'product.isActive': true } },
  ];

  if (query.search) {
    const pattern = safeSearchRegex(query.search);
    pipeline.push({
      $match: {
        $or: [
          { 'product.name': pattern },
          { 'product.sku': pattern },
          { 'product.brandName': pattern },
        ],
      },
    });
  }

  if (filters.lowStockOnly) {
    // "Low" is per product: a shop keeps 2000 pencils and 5 ladders, so one
    // organization-wide threshold would be meaningless. The product's own
    // reorder level decides, and a level of zero means "do not warn me".
    pipeline.push({
      $match: {
        $expr: {
          $and: [
            { $gt: ['$product.reorderLevel', 0] },
            { $lte: ['$quantity', '$product.reorderLevel'] },
          ],
        },
      },
    });
  }

  pipeline.push({
    $lookup: {
      from: Branch.collection.name,
      localField: 'branchId',
      foreignField: '_id',
      as: 'branch',
    },
  });
  pipeline.push({ $unwind: '$branch' });

  pipeline.push({
    $project: {
      _id: 1,
      quantity: 1,
      lastMovementAt: 1,
      productId: '$product._id',
      productName: '$product.name',
      sku: '$product.sku',
      brandName: '$product.brandName',
      categoryName: '$product.categoryName',
      unitSymbol: '$product.unitSymbol',
      reorderLevel: '$product.reorderLevel',
      branchId: '$branch._id',
      branchName: '$branch.name',
      isLow: {
        $and: [
          { $gt: ['$product.reorderLevel', 0] },
          { $lte: ['$quantity', '$product.reorderLevel'] },
        ],
      },
    },
  });

  const sortField = query.sortBy === 'quantity' ? 'quantity' : 'productName';
  pipeline.push({ $sort: { [sortField]: query.sortOrder === 'asc' ? 1 : -1 } });

  const [rows, countResult] = await Promise.all([
    InventoryBalance.aggregate([
      ...pipeline,
      { $skip: toSkip(query.page, query.limit) },
      { $limit: query.limit },
    ]),
    InventoryBalance.aggregate([...pipeline, { $count: 'total' }]),
  ]);

  return {
    items: rows,
    total: (countResult[0] as { total?: number } | undefined)?.total ?? 0,
    page: query.page,
    limit: query.limit,
  };
}

/** The movement history: what happened, when, and who did it. */
export async function listMovements(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: { productId?: string; branchId?: string; type?: string },
) {
  const branchId = filters.branchId ? new Types.ObjectId(filters.branchId) : undefined;

  const filter: Record<string, unknown> = {
    ...orgFilter(ctx),
    ...visibleBranchFilter(ctx, branchId),
  };
  if (filters.productId) filter.productId = new Types.ObjectId(filters.productId);
  if (filters.type) filter.type = filters.type;

  const [rows, total] = await Promise.all([
    InventoryTransaction.find(filter)
      .sort({ occurredAt: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
    InventoryTransaction.countDocuments(filter),
  ]);

  // Branch names come from a tenant-scoped query rather than `populate`, which
  // would resolve by _id alone and so carry no organizationId.
  const branches = await Branch.find({
    ...orgFilter(ctx),
    _id: { $in: rows.map((row) => row.branchId) },
  })
    .select('name')
    .lean();
  const branchNameById = new Map(branches.map((branch) => [branch._id.toString(), branch.name]));

  const items = rows.map((row) => ({
    ...row,
    branchName: branchNameById.get(row.branchId.toString()) ?? 'Unknown branch',
  }));

  return { items, total, page: query.page, limit: query.limit };
}

/* -------------------------------------------------------------------------- */
/* Stock adjustments                                                           */
/* -------------------------------------------------------------------------- */

export interface AdjustmentInput {
  branchId: string;
  reason: AdjustmentReason;
  notes?: string;
  items: { productId: string; countedQuantity: number }[];
}

/**
 * Correct recorded stock to what was actually counted.
 *
 * Runs as one transaction so a session that fails halfway does not leave some
 * products corrected and others not - which would be worse than not having
 * counted at all, because nobody would know where it stopped.
 */
export async function createAdjustment(ctx: TenantContext, input: AdjustmentInput) {
  const branchId = new Types.ObjectId(input.branchId);
  assertBranchAccess(ctx, branchId);

  const branch = await Branch.findOne({ ...orgFilter(ctx), _id: branchId }).lean();
  if (!branch) throw AppError.notFound('Branch');

  const productIds = input.items.map((item) => new Types.ObjectId(item.productId));
  const products = await Product.find({ ...orgFilter(ctx), _id: { $in: productIds } }).lean();
  if (products.length !== input.items.length) {
    throw AppError.badRequest('One or more products are not valid');
  }
  const productById = new Map(products.map((product) => [product._id.toString(), product]));

  // Whole-unit products cannot hold a fractional count. Catching it here gives a
  // clear message instead of a puzzling 2.5-pencil figure later.
  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) continue;
    if (item.countedQuantity < 0) {
      throw AppError.badRequest(`Counted quantity for ${product.name} cannot be negative`);
    }
  }

  return withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.organizationId, 'ADJ', session);
    const documentId = new Types.ObjectId();
    const lines = [];

    for (const item of input.items) {
      const product = productById.get(item.productId)!;
      const result = await applyCountCorrection(
        ctx,
        {
          branchId,
          productId: product._id,
          countedQuantity: item.countedQuantity,
          type: INVENTORY_TRANSACTION_TYPES.ADJUSTMENT,
          reason: input.reason,
          ...(input.notes ? { notes: input.notes } : {}),
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: documentId,
          referenceNumber: number,
        },
        session,
      );

      lines.push({
        productId: product._id,
        productName: product.name,
        productSku: product.sku,
        unitSymbol: product.unitSymbol,
        previousQuantity: result.previousQuantity,
        newQuantity: result.newQuantity,
        difference: result.difference,
      });
    }

    const [adjustment] = await StockAdjustment.create(
      [
        {
          _id: documentId,
          ...orgFilter(ctx),
          branchId,
          number,
          reason: input.reason,
          notes: input.notes,
          items: lines,
          performedBy: ctx.userId,
          performedByName: ctx.userName,
        },
      ],
      session ? { session } : {},
    );

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.INVENTORY_ADJUSTED,
        entityType: 'StockAdjustment',
        entityId: documentId,
        entityLabel: number,
        branchId,
        after: {
          reason: input.reason,
          lines: lines.map((line) => ({
            product: line.productName,
            from: line.previousQuantity,
            to: line.newQuantity,
          })),
        },
      },
      session,
    );

    return adjustment?.toObject();
  });
}

/**
 * Record what a branch started with.
 *
 * Kept separate from an adjustment so the ledger reads honestly: the first row
 * against a product says OPENING_STOCK rather than looking like a mysterious
 * correction on day one.
 */
export async function setOpeningStock(
  ctx: TenantContext,
  input: { branchId: string; items: { productId: string; quantity: number }[] },
) {
  const branchId = new Types.ObjectId(input.branchId);
  assertBranchAccess(ctx, branchId);

  const productIds = input.items.map((item) => new Types.ObjectId(item.productId));
  const products = await Product.find({ ...orgFilter(ctx), _id: { $in: productIds } }).lean();
  const productById = new Map(products.map((product) => [product._id.toString(), product]));

  return withTransaction(async (session) => {
    const results = [];
    for (const item of input.items) {
      const product = productById.get(item.productId);
      if (!product) throw AppError.badRequest('One or more products are not valid');

      const existing = await InventoryBalance.findOne({
        ...orgFilter(ctx),
        branchId,
        productId: product._id,
      })
        .select('quantity')
        .lean();

      if (existing && existing.quantity !== 0) {
        throw AppError.businessRule(
          `${product.name} already has stock at this branch. Use a stock adjustment instead`,
        );
      }

      if (item.quantity <= 0) continue;

      const result = await applyMovement(
        ctx,
        {
          branchId,
          productId: product._id,
          type: INVENTORY_TRANSACTION_TYPES.OPENING_STOCK,
          quantity: item.quantity,
          reason: ADJUSTMENT_REASONS.PHYSICAL_COUNT,
          referenceType: 'OPENING_STOCK',
        },
        { allowNegative: false },
        session,
      );
      results.push({ productId: product._id.toString(), quantity: result.balanceAfter });
    }

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.OPENING_STOCK_SET,
        entityType: 'InventoryBalance',
        branchId,
        after: { products: results.length },
      },
      session,
    );

    return { updated: results.length, items: results };
  });
}

/* -------------------------------------------------------------------------- */
/* Stock transfers                                                             */
/* -------------------------------------------------------------------------- */

export interface TransferInput {
  fromBranchId: string;
  toBranchId: string;
  notes?: string;
  items: { productId: string; quantity: number }[];
}

/**
 * Send stock from one branch to another.
 *
 * This is the dispatch half. Stock leaves the source now and the transfer sits
 * IN_TRANSIT until the destination confirms receipt. The goods on the truck
 * belong to neither branch, and showing them at the destination early would let
 * staff there promise stock they do not have.
 */
export async function createTransfer(ctx: TenantContext, input: TransferInput) {
  const fromBranchId = new Types.ObjectId(input.fromBranchId);
  const toBranchId = new Types.ObjectId(input.toBranchId);

  if (fromBranchId.equals(toBranchId)) {
    throw AppError.badRequest('Choose two different branches');
  }

  // Only the source branch needs to be one this person works in. A branch
  // manager may legitimately send stock to a branch they have no access to.
  assertBranchAccess(ctx, fromBranchId);

  const [fromBranch, toBranch] = await Promise.all([
    Branch.findOne({ ...orgFilter(ctx), _id: fromBranchId }).lean(),
    Branch.findOne({ ...orgFilter(ctx), _id: toBranchId }).lean(),
  ]);
  if (!fromBranch) throw AppError.notFound('Source branch');
  if (!toBranch) throw AppError.notFound('Destination branch');
  if (!toBranch.isActive) throw AppError.businessRule('The destination branch is not active');

  const productIds = input.items.map((item) => new Types.ObjectId(item.productId));
  const products = await Product.find({ ...orgFilter(ctx), _id: { $in: productIds } }).lean();
  const productById = new Map(products.map((product) => [product._id.toString(), product]));
  if (products.length !== new Set(input.items.map((item) => item.productId)).size) {
    throw AppError.badRequest('One or more products are not valid');
  }

  const policy = await getStockPolicy(ctx);

  const created = await withTransaction(async (session) => {
    const number = await nextDocumentNumber(ctx.organizationId, 'TRF', session);
    const documentId = new Types.ObjectId();
    const lines = [];

    for (const item of input.items) {
      const product = productById.get(item.productId)!;

      // Stock leaves the source here. If any line has insufficient stock the
      // whole transfer fails, so a half-sent consignment cannot exist.
      await applyMovement(
        ctx,
        {
          branchId: fromBranchId,
          productId: product._id,
          type: INVENTORY_TRANSACTION_TYPES.TRANSFER_OUT,
          quantity: item.quantity,
          referenceType: 'STOCK_TRANSFER',
          referenceId: documentId,
          referenceNumber: number,
          ...(input.notes ? { notes: input.notes } : {}),
        },
        policy,
        session,
      );

      lines.push({
        productId: product._id,
        productName: product.name,
        productSku: product.sku,
        unitSymbol: product.unitSymbol,
        quantity: item.quantity,
        receivedQuantity: 0,
      });
    }

    const [transfer] = await StockTransfer.create(
      [
        {
          _id: documentId,
          ...orgFilter(ctx),
          fromBranchId,
          toBranchId,
          fromBranchName: fromBranch.name,
          toBranchName: toBranch.name,
          number,
          status: STOCK_TRANSFER_STATUSES.IN_TRANSIT,
          items: lines,
          notes: input.notes,
          dispatchedAt: new Date(),
          createdBy: ctx.userId,
          createdByName: ctx.userName,
        },
      ],
      session ? { session } : {},
    );

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.STOCK_TRANSFER_CREATED,
        entityType: 'StockTransfer',
        entityId: documentId,
        entityLabel: number,
        branchId: fromBranchId,
        after: {
          from: fromBranch.name,
          to: toBranch.name,
          lines: lines.length,
        },
      },
      session,
    );

    return transfer?.toObject();
  });

  // Tell the destination goods are on their way, once the dispatch has committed.
  if (created) {
    await notify([
      {
        organizationId: ctx.organizationId,
        type: NOTIFICATION_TYPES.TRANSFER_INCOMING,
        severity: NOTIFICATION_SEVERITIES.INFO,
        title: `Stock is on its way from ${fromBranch.name}`,
        body: `Transfer ${created.number} to ${toBranch.name}: ${input.items.length} item${input.items.length === 1 ? '' : 's'}`,
        link: '/transfers',
        requiredPermission: PERMISSIONS.INVENTORY_VIEW,
        branchId: toBranchId,
        dedupeKey: `TRANSFER_INCOMING:${created._id.toString()}`,
      },
    ]);
  }

  return created;
}

/**
 * Confirm arrival at the destination.
 *
 * The received quantity may be less than what was sent - boxes get damaged or
 * go missing in transit. The shortfall stays visible on the document rather than
 * being silently absorbed, because someone needs to chase it.
 */
export async function receiveTransfer(
  ctx: TenantContext,
  transferId: Types.ObjectId,
  input: { items?: { productId: string; receivedQuantity: number }[] },
) {
  const transfer = await StockTransfer.findOne({ ...orgFilter(ctx), _id: transferId });
  if (!transfer) throw AppError.notFound('Transfer');

  if (transfer.status !== STOCK_TRANSFER_STATUSES.IN_TRANSIT) {
    throw AppError.businessRule(`This transfer is already ${transfer.status.toLowerCase()}`);
  }

  // Receiving is the destination branch's job.
  assertBranchAccess(ctx, transfer.toBranchId);

  const receivedByProduct = new Map(
    (input.items ?? []).map((item) => [item.productId, item.receivedQuantity]),
  );

  return withTransaction(async (session) => {
    for (const line of transfer.items) {
      const productKey = line.productId.toString();
      // Default to receiving exactly what was sent, which is the normal case.
      const received = receivedByProduct.get(productKey) ?? line.quantity;

      if (received < 0) throw AppError.badRequest('Received quantity cannot be negative');
      if (received > line.quantity) {
        throw AppError.businessRule(
          `Cannot receive more ${line.productName} than was sent (${line.quantity})`,
        );
      }

      if (received > 0) {
        await applyMovement(
          ctx,
          {
            branchId: transfer.toBranchId,
            productId: line.productId,
            type: INVENTORY_TRANSACTION_TYPES.TRANSFER_IN,
            quantity: received,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transfer._id,
            referenceNumber: transfer.number,
          },
          { allowNegative: false },
          session,
        );
      }

      line.receivedQuantity = received;
    }

    transfer.status = STOCK_TRANSFER_STATUSES.RECEIVED;
    transfer.receivedAt = new Date();
    transfer.receivedBy = ctx.userId;
    transfer.receivedByName = ctx.userName;
    await transfer.save(session ? { session } : {});

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.STOCK_TRANSFER_RECEIVED,
        entityType: 'StockTransfer',
        entityId: transfer._id,
        entityLabel: transfer.number,
        branchId: transfer.toBranchId,
        after: {
          lines: transfer.items.map((line) => ({
            product: line.productName,
            sent: line.quantity,
            received: line.receivedQuantity,
          })),
        },
      },
      session,
    );

    return transfer.toObject();
  });
}

/** Recall a transfer that never left, putting the stock back at the source. */
export async function cancelTransfer(ctx: TenantContext, transferId: Types.ObjectId) {
  const transfer = await StockTransfer.findOne({ ...orgFilter(ctx), _id: transferId });
  if (!transfer) throw AppError.notFound('Transfer');
  if (transfer.status !== STOCK_TRANSFER_STATUSES.IN_TRANSIT) {
    throw AppError.businessRule('Only a transfer that is still in transit can be cancelled');
  }

  assertBranchAccess(ctx, transfer.fromBranchId);

  return withTransaction(async (session) => {
    for (const line of transfer.items) {
      // Returned as TRANSFER_IN at the source, so the ledger shows the goods
      // coming back rather than the original despatch disappearing.
      await applyMovement(
        ctx,
        {
          branchId: transfer.fromBranchId,
          productId: line.productId,
          type: INVENTORY_TRANSACTION_TYPES.TRANSFER_IN,
          quantity: line.quantity,
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer._id,
          referenceNumber: transfer.number,
          notes: 'Transfer cancelled, stock returned',
        },
        { allowNegative: false },
        session,
      );
    }

    transfer.status = STOCK_TRANSFER_STATUSES.CANCELLED;
    await transfer.save(session ? { session } : {});

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.STOCK_TRANSFER_CANCELLED,
        entityType: 'StockTransfer',
        entityId: transfer._id,
        entityLabel: transfer.number,
        branchId: transfer.fromBranchId,
      },
      session,
    );

    return transfer.toObject();
  });
}

export async function listTransfers(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: { status?: string; branchId?: string },
) {
  const filter: Record<string, unknown> = { ...orgFilter(ctx) };
  if (filters.status) filter.status = filters.status;

  if (filters.branchId) {
    const branchId = new Types.ObjectId(filters.branchId);
    assertBranchAccess(ctx, branchId);
    filter.$or = [{ fromBranchId: branchId }, { toBranchId: branchId }];
  } else if (!ctx.allBranches) {
    filter.$or = [
      { fromBranchId: { $in: ctx.branchIds } },
      { toBranchId: { $in: ctx.branchIds } },
    ];
  }

  const [items, total] = await Promise.all([
    StockTransfer.find(filter)
      .sort({ createdAt: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
    StockTransfer.countDocuments(filter),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function getTransfer(ctx: TenantContext, transferId: Types.ObjectId) {
  const transfer = await StockTransfer.findOne({ ...orgFilter(ctx), _id: transferId }).lean();
  if (!transfer) throw AppError.notFound('Transfer');
  return transfer;
}

/** Headline numbers for the dashboard. */
export async function stockSummary(ctx: TenantContext, branchId?: string) {
  const scope = visibleBranchFilter(ctx, branchId ? new Types.ObjectId(branchId) : undefined);
  const match = { ...orgFilter(ctx), ...scope };

  const [totals, lowStock, organization] = await Promise.all([
    InventoryBalance.aggregate<{ _id: null; totalUnits: number; skuCount: number }>([
      { $match: match },
      { $group: { _id: null, totalUnits: { $sum: '$quantity' }, skuCount: { $sum: 1 } } },
    ]),
    InventoryBalance.aggregate<{ count: number }>([
      { $match: match },
      {
        $lookup: {
          from: Product.collection.name,
          localField: 'productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $match: {
          'product.isActive': true,
          $expr: {
            $and: [
              { $gt: ['$product.reorderLevel', 0] },
              { $lte: ['$quantity', '$product.reorderLevel'] },
            ],
          },
        },
      },
      { $count: 'count' },
    ]),
    Organization.findById(ctx.organizationId).select('settings').lean(),
  ]);

  return {
    totalUnits: totals[0]?.totalUnits ?? 0,
    stockedProducts: totals[0]?.skuCount ?? 0,
    lowStockCount: lowStock[0]?.count ?? 0,
    allowNegativeStock: organization?.settings.allowNegativeStock ?? false,
  };
}
