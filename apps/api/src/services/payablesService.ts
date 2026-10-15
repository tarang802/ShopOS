import type { Types } from 'mongoose';
import { PURCHASE_ORDER_STATUSES } from '@shopos/shared';
import { PurchaseOrder } from '../db/models';
import { orgFilter, type TenantContext } from '../core/tenantContext';

/**
 * What the business owes its suppliers.
 *
 * The aggregation form of `purchaseOwedPaise` in `@shopos/shared`: the value of
 * goods received, less goods sent back, less what has been paid, never below zero.
 * Written for the database so a supplier's balance across thousands of orders is
 * added up without shipping them to Node.
 */

export const OWED_EXPRESSION = {
  $max: [
    0,
    {
      $subtract: [
        {
          $subtract: [
            { $ifNull: ['$receivedValuePaise', 0] },
            { $ifNull: ['$returnedPaise', 0] },
          ],
        },
        { $ifNull: ['$paidPaise', 0] },
      ],
    },
  ],
} as const;

/** Orders that can carry a payable: anything sent, whether or not it has arrived yet. */
export const PAYABLE_ORDER_STATUSES = [
  PURCHASE_ORDER_STATUSES.SENT,
  PURCHASE_ORDER_STATUSES.PARTIALLY_RECEIVED,
  PURCHASE_ORDER_STATUSES.RECEIVED,
] as const;

export async function supplierOwedPaise(
  ctx: TenantContext,
  supplierId: Types.ObjectId,
): Promise<number> {
  const rows = await PurchaseOrder.aggregate<{ total: number }>([
    {
      $match: {
        ...orgFilter(ctx),
        supplierId,
        status: { $in: [...PAYABLE_ORDER_STATUSES] },
      },
    },
    { $group: { _id: null, total: { $sum: OWED_EXPRESSION } } },
  ]);

  return rows[0]?.total ?? 0;
}
