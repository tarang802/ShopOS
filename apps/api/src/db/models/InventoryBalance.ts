import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * How much of one product is at one branch, right now.
 *
 * WHY a separate collection rather than an array on the product: a 50-branch
 * chain would otherwise put 50 entries inside every product document, and every
 * sale at any branch would contend on the same document. Here, a sale in Patna
 * touches only the Patna row.
 *
 * WHY a stored number at all, when the ledger already holds every movement:
 * because "what is the stock?" is asked constantly and summing a million ledger
 * rows per lookup is not viable. This is a cached total. The ledger remains the
 * source of truth, and this figure must always be reproducible from it.
 *
 * Every change to `quantity` goes through the inventory service, which writes
 * the ledger entry in the same operation. Nothing else may touch it.
 */

export interface IInventoryBalance {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  productId: Types.ObjectId;
  quantity: number;
  /**
   * Committed to orders but not yet dispatched. Reserved stock is still on the
   * shelf but is no longer available to promise to somebody else. Used from the
   * sales phase onward; kept at zero until then.
   */
  reservedQuantity: number;
  lastMovementAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const inventoryBalanceSchema = new Schema<IInventoryBalance>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, default: 0 },
    reservedQuantity: { type: Number, required: true, default: 0, min: 0 },
    lastMovementAt: { type: Date },
  },
  { timestamps: true },
);

// One row per product per branch. This unique index is also what makes the
// upsert in the inventory service safe under concurrency.
inventoryBalanceSchema.index({ organizationId: 1, branchId: 1, productId: 1 }, { unique: true });
// "Stock of this product across all branches" - the product detail screen.
inventoryBalanceSchema.index({ organizationId: 1, productId: 1 });
// "What is running low at this branch?" - the dashboard.
inventoryBalanceSchema.index({ organizationId: 1, branchId: 1, quantity: 1 });

inventoryBalanceSchema.plugin(tenantGuard);

export const InventoryBalance = model<IInventoryBalance>(
  'InventoryBalance',
  inventoryBalanceSchema,
);
