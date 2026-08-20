import { Schema, Types, model } from 'mongoose';
import type { InventoryTransactionType } from '@shopos/shared';
import { INVENTORY_TRANSACTION_TYPES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * The stock ledger. Append-only, never edited, never deleted.
 *
 * WHY this exists: a mutable stock number can only ever tell you what it is, not
 * how it got there. When 40 pieces go missing, "the number says 1160" is not an
 * answer - the owner needs to see that 1200 came in on Tuesday, 30 were sold, and
 * 10 were written off as damaged with a reason and a name against them.
 *
 * Every movement in ShopOS writes one row here. The balance document is a cache
 * of the running total; this collection is the truth, and the balance must
 * always be reproducible by summing it.
 *
 * `quantityDelta` is signed: positive adds stock, negative removes it. That
 * makes reconstruction a plain sum with no branching on type.
 *
 * This collection grows forever, so it is never embedded anywhere, and every
 * query against it is bounded by tenant and time.
 */

export interface IInventoryTransaction {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  branchId: Types.ObjectId;
  productId: Types.ObjectId;

  type: InventoryTransactionType;
  /** Signed change. +50 for a receipt, -3 for a sale. */
  quantityDelta: number;
  /** Branch stock immediately after this movement, for a readable audit trail. */
  balanceAfter: number;

  /** What caused it: STOCK_ADJUSTMENT, STOCK_TRANSFER, GOODS_RECEIPT, INVOICE. */
  referenceType?: string;
  referenceId?: Types.ObjectId;
  /** Human-facing document number, e.g. ADJ-2026-000012. */
  referenceNumber?: string;

  /** Required on adjustments. Damage, theft, physical count, and so on. */
  reason?: string;
  notes?: string;

  /** Snapshot for readable history without joining the catalogue. */
  productName: string;
  productSku: string;

  performedBy: Types.ObjectId;
  performedByName: string;
  occurredAt: Date;
  createdAt: Date;
}

const inventoryTransactionSchema = new Schema<IInventoryTransaction>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },

    type: {
      type: String,
      enum: Object.values(INVENTORY_TRANSACTION_TYPES),
      required: true,
    },
    quantityDelta: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },

    referenceType: { type: String, trim: true, maxlength: 40 },
    referenceId: { type: Schema.Types.ObjectId },
    referenceNumber: { type: String, trim: true, maxlength: 40 },

    reason: { type: String, trim: true, maxlength: 40 },
    notes: { type: String, trim: true, maxlength: 500 },

    productName: { type: String, required: true, maxlength: 200 },
    productSku: { type: String, required: true, maxlength: 40 },

    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    performedByName: { type: String, required: true, maxlength: 120 },
    occurredAt: { type: Date, required: true, default: () => new Date() },
  },
  // No updatedAt: a ledger row is written once and never modified.
  { timestamps: { createdAt: true, updatedAt: false } },
);

// "History of this product at this branch, newest first" - the movement view.
inventoryTransactionSchema.index({ organizationId: 1, productId: 1, occurredAt: -1 });
// "Everything that happened at this branch" - the branch activity feed.
inventoryTransactionSchema.index({ organizationId: 1, branchId: 1, occurredAt: -1 });
// "Which movements did this document cause?" - drilling into a transfer.
inventoryTransactionSchema.index({ organizationId: 1, referenceType: 1, referenceId: 1 });
// Reporting by movement type over a date range.
inventoryTransactionSchema.index({ organizationId: 1, type: 1, occurredAt: -1 });

inventoryTransactionSchema.plugin(tenantGuard);

export const InventoryTransaction = model<IInventoryTransaction>(
  'InventoryTransaction',
  inventoryTransactionSchema,
);
