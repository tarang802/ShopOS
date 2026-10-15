import type { ClientSession, Types } from 'mongoose';
import { InventoryBalance, Product } from '../db/models';
import { sessionOption } from '../db/transaction';
import { orgFilter, type TenantContext } from '../core/tenantContext';

/**
 * Keeping a product's cost current.
 *
 * ShopOS uses a moving average: when goods arrive at a price, the product's cost
 * becomes the weighted average of what is already on the shelf and what just
 * came in. It is the simplest costing method that stays honest when the same
 * item is bought at different prices through the year, and it is what most
 * shops do on paper already.
 *
 * It is a cost snapshot, not a ledger - each invoice line freezes the cost at
 * the moment of sale, so a later purchase never rewrites a past margin.
 */

/**
 * The moving-average cost after receiving `receivedQty` units at `unitCostPaise`.
 *
 * Pure, so the behaviour at the edges can be tested directly: with nothing on
 * hand, or no previous cost, the new price simply becomes the cost.
 */
export function movingAverageCost(input: {
  onHandQty: number;
  currentCostPaise: number | undefined;
  receivedQty: number;
  unitCostPaise: number;
}): number {
  const onHand = Math.max(0, input.onHandQty);
  if (input.currentCostPaise === undefined || onHand === 0) return input.unitCostPaise;

  const totalQty = onHand + input.receivedQty;
  if (totalQty <= 0) return input.unitCostPaise;

  return Math.round(
    (onHand * input.currentCostPaise + input.receivedQty * input.unitCostPaise) / totalQty,
  );
}

/**
 * Fold a receipt into the product's cost.
 *
 * Must run BEFORE the receipt increases stock: the average weights what was on
 * hand beforehand against what has just arrived, so reading the balance after
 * the increase would count the new goods twice.
 */
export async function applyReceiptCost(
  ctx: TenantContext,
  input: { productId: Types.ObjectId; receivedQty: number; unitCostPaise: number },
  session?: ClientSession,
): Promise<number> {
  const opts = sessionOption(session);

  const [product, onHand] = await Promise.all([
    Product.findOne({ ...orgFilter(ctx), _id: input.productId })
      .select('+costPricePaise')
      .setOptions(opts)
      .lean(),
    InventoryBalance.aggregate<{ quantity: number }>([
      { $match: { ...orgFilter(ctx), productId: input.productId } },
      { $group: { _id: null, quantity: { $sum: '$quantity' } } },
    ]).session(session ?? null),
  ]);

  const cost = movingAverageCost({
    onHandQty: onHand[0]?.quantity ?? 0,
    currentCostPaise: product?.costPricePaise,
    receivedQty: input.receivedQty,
    unitCostPaise: input.unitCostPaise,
  });

  await Product.updateOne(
    { ...orgFilter(ctx), _id: input.productId },
    { $set: { costPricePaise: cost } },
    opts,
  );

  return cost;
}
