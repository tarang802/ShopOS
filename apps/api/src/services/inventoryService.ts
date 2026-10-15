import type { ClientSession, Types } from 'mongoose';
import {
  ERROR_CODES,
  INBOUND_TRANSACTION_TYPES,
  type InventoryTransactionType,
} from '@shopos/shared';
import {
  InventoryBalance,
  InventoryTransaction,
  Organization,
  Product,
  Unit,
} from '../db/models';
import { sessionOption } from '../db/transaction';
import { AppError } from '../core/AppError';
import { orgFilter, type TenantContext } from '../core/tenantContext';

/**
 * The one place stock ever changes.
 *
 * Every movement in ShopOS - a goods receipt, a sale, damage, a transfer -
 * comes through `applyMovement`. Nothing else writes to InventoryBalance.
 * Keeping it to a single door is what guarantees that the ledger and the
 * balance can never disagree: it is not possible to change one without the
 * other.
 *
 * THE CONCURRENCY PROBLEM, and how it is solved:
 *
 * Two staff members at two terminals sell the last 5 units at the same instant.
 * The naive version reads 5, subtracts 5, writes 0 - twice. Ten units have been
 * sold and five existed.
 *
 * The fix is to never read-then-write. The decrement is expressed as one
 * conditional update:
 *
 *   findOneAndUpdate(
 *     { ...., quantity: { $gte: 5 } },     // only if there is enough
 *     { $inc: { quantity: -5 } },          // take it
 *   )
 *
 * MongoDB applies that atomically. The second terminal finds no matching
 * document, because by then the quantity is 0, and is told there is not enough
 * stock. No lock, no transaction, no race.
 */

export interface MovementInput {
  branchId: Types.ObjectId;
  productId: Types.ObjectId;
  type: InventoryTransactionType;
  /** Always positive. The direction comes from `type`, or from `direction`. */
  quantity: number;
  /**
   * Overrides the direction implied by `type`.
   *
   * Most movement types only go one way: a PURCHASE always adds, a SALE always
   * removes. ADJUSTMENT is the exception - a stock count can correct a figure
   * upward or downward - so the caller states which way it goes.
   */
  direction?: 'IN' | 'OUT';
  referenceType?: string;
  referenceId?: Types.ObjectId;
  referenceNumber?: string;
  reason?: string;
  notes?: string;
  occurredAt?: Date;
}

export interface MovementResult {
  productId: Types.ObjectId;
  branchId: Types.ObjectId;
  quantityDelta: number;
  balanceAfter: number;
}

/** Whether this business permits stock to fall below zero. */
export async function getStockPolicy(ctx: TenantContext): Promise<{ allowNegative: boolean }> {
  const organization = await Organization.findById(ctx.organizationId)
    .select('settings.allowNegativeStock')
    .lean();
  return { allowNegative: organization?.settings.allowNegativeStock ?? false };
}

function isInbound(type: InventoryTransactionType): boolean {
  return INBOUND_TRANSACTION_TYPES.includes(type);
}

/**
 * Apply one stock movement: update the balance and append to the ledger.
 *
 * `allowNegative` is passed in rather than read here, so a batch of movements
 * (a whole transfer, say) reads the setting once instead of once per line.
 */
export async function applyMovement(
  ctx: TenantContext,
  input: MovementInput,
  options: { allowNegative: boolean },
  session?: ClientSession,
): Promise<MovementResult> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw AppError.badRequest('Quantity must be more than zero');
  }

  const product = await Product.findOne({ ...orgFilter(ctx), _id: input.productId })
    .select('name sku unitSymbol unitId')
    .lean();
  if (!product) throw AppError.notFound('Product');

  // You can sell 2.5 kg of nails but not 2.5 pencils. The unit is only looked up
  // for a fractional quantity, so the common whole-number movement pays nothing.
  if (!Number.isInteger(input.quantity)) {
    const unit = await Unit.findOne({ ...orgFilter(ctx), _id: product.unitId })
      .select('name allowsDecimal')
      .lean();
    if (unit && !unit.allowsDecimal) {
      throw AppError.badRequest(
        `${product.name} is counted in whole ${unit.name.toLowerCase()}s, so ${input.quantity} is not a valid quantity`,
      );
    }
  }

  const goesIn = input.direction ? input.direction === 'IN' : isInbound(input.type);
  const delta = goesIn ? input.quantity : -input.quantity;
  const opts = sessionOption(session);

  let balance;

  if (delta < 0 && !options.allowNegative) {
    // The conditional decrement described above. If no document matches, either
    // there is no stock row at all or there is not enough in it.
    balance = await InventoryBalance.findOneAndUpdate(
      {
        ...orgFilter(ctx),
        branchId: input.branchId,
        productId: input.productId,
        quantity: { $gte: input.quantity },
      },
      { $inc: { quantity: delta }, $set: { lastMovementAt: new Date() } },
      { returnDocument: 'after', ...opts },
    );

    if (!balance) {
      const current = await InventoryBalance.findOne({
        ...orgFilter(ctx),
        branchId: input.branchId,
        productId: input.productId,
      })
        .select('quantity')
        .lean();

      throw new AppError(
        422,
        ERROR_CODES.INSUFFICIENT_STOCK,
        `Not enough stock for ${product.name}. Available: ${current?.quantity ?? 0} ${product.unitSymbol}, needed: ${input.quantity} ${product.unitSymbol}`,
      );
    }
  } else {
    // Increases, and decreases where the business has chosen to allow negative
    // stock, can safely upsert: there is no condition to fail.
    balance = await InventoryBalance.findOneAndUpdate(
      { ...orgFilter(ctx), branchId: input.branchId, productId: input.productId },
      {
        $inc: { quantity: delta },
        $set: { lastMovementAt: new Date() },
        $setOnInsert: { reservedQuantity: 0 },
      },
      { returnDocument: 'after', upsert: true, ...opts },
    );
  }

  if (!balance) throw AppError.internal('Could not update stock');

  await InventoryTransaction.create(
    [
      {
        ...orgFilter(ctx),
        branchId: input.branchId,
        productId: input.productId,
        type: input.type,
        quantityDelta: delta,
        balanceAfter: balance.quantity,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        referenceNumber: input.referenceNumber,
        reason: input.reason,
        notes: input.notes,
        productName: product.name,
        productSku: product.sku,
        performedBy: ctx.userId,
        performedByName: ctx.userName,
        occurredAt: input.occurredAt ?? new Date(),
      },
    ],
    opts,
  );

  return {
    productId: input.productId,
    branchId: input.branchId,
    quantityDelta: delta,
    balanceAfter: balance.quantity,
  };
}

/**
 * Set stock to an exact figure, whatever it is now.
 *
 * Used by physical stock counts, where the staff member knows the answer rather
 * than the change. The difference is worked out here and recorded as an ordinary
 * movement, so a correction is as traceable as a sale.
 */
export async function applyCountCorrection(
  ctx: TenantContext,
  input: {
    branchId: Types.ObjectId;
    productId: Types.ObjectId;
    countedQuantity: number;
    type: InventoryTransactionType;
    reason: string;
    notes?: string;
    referenceType?: string;
    referenceId?: Types.ObjectId;
    referenceNumber?: string;
  },
  session?: ClientSession,
): Promise<{ previousQuantity: number; newQuantity: number; difference: number }> {
  const existing = await InventoryBalance.findOne({
    ...orgFilter(ctx),
    branchId: input.branchId,
    productId: input.productId,
  })
    .select('quantity')
    .lean();

  const previousQuantity = existing?.quantity ?? 0;
  const difference = input.countedQuantity - previousQuantity;

  if (difference === 0) {
    return { previousQuantity, newQuantity: previousQuantity, difference: 0 };
  }

  // A correction may legitimately take stock below zero if that is genuinely
  // what was counted, so the negative-stock policy does not apply here. The
  // direction is stated explicitly, because an adjustment is the one movement
  // type that can go either way.
  await applyMovement(
    ctx,
    {
      branchId: input.branchId,
      productId: input.productId,
      type: input.type,
      direction: difference > 0 ? 'IN' : 'OUT',
      quantity: Math.abs(difference),
      ...(input.referenceType ? { referenceType: input.referenceType } : {}),
      ...(input.referenceId ? { referenceId: input.referenceId } : {}),
      ...(input.referenceNumber ? { referenceNumber: input.referenceNumber } : {}),
      reason: input.reason,
      ...(input.notes ? { notes: input.notes } : {}),
    },
    { allowNegative: true },
    session,
  );

  return {
    previousQuantity,
    newQuantity: input.countedQuantity,
    difference,
  };
}
