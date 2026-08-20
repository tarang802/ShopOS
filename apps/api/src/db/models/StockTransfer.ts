import { Schema, Types, model } from 'mongoose';
import type { StockTransferStatus } from '@shopos/shared';
import { STOCK_TRANSFER_STATUSES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * Goods moving from one branch to another.
 *
 * WHY two steps rather than one: stock that has left Bhagalpur but not yet
 * reached Patna belongs to neither. If a transfer moved the number instantly,
 * Patna would appear to hold goods that are still on a truck, and staff there
 * would promise them to a customer. So a transfer is dispatched (stock leaves the
 * source, status IN_TRANSIT) and later received (stock arrives at the
 * destination). The gap between them is real, and the system should show it.
 *
 * The received quantity may be less than the dispatched quantity - boxes get
 * damaged in transit. The shortfall stays visible on the document instead of
 * being quietly absorbed.
 */

export interface IStockTransferItem {
  productId: Types.ObjectId;
  productName: string;
  productSku: string;
  unitSymbol: string;
  /** Quantity sent from the source branch. */
  quantity: number;
  /** Quantity confirmed at the destination. Zero until the transfer is received. */
  receivedQuantity: number;
}

export interface IStockTransfer {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  fromBranchId: Types.ObjectId;
  toBranchId: Types.ObjectId;
  fromBranchName: string;
  toBranchName: string;
  /** TRF-2026-000007, from the atomic counter. */
  number: string;
  status: StockTransferStatus;
  items: IStockTransferItem[];
  notes?: string;
  dispatchedAt?: Date;
  receivedAt?: Date;
  createdBy: Types.ObjectId;
  createdByName: string;
  receivedBy?: Types.ObjectId;
  receivedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const stockTransferItemSchema = new Schema<IStockTransferItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true, maxlength: 200 },
    productSku: { type: String, required: true, maxlength: 40 },
    unitSymbol: { type: String, required: true, maxlength: 12 },
    quantity: { type: Number, required: true, min: 0 },
    receivedQuantity: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const stockTransferSchema = new Schema<IStockTransfer>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    fromBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    toBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    fromBranchName: { type: String, required: true, maxlength: 120 },
    toBranchName: { type: String, required: true, maxlength: 120 },
    number: { type: String, required: true, trim: true, maxlength: 40 },
    status: {
      type: String,
      enum: Object.values(STOCK_TRANSFER_STATUSES),
      required: true,
      default: STOCK_TRANSFER_STATUSES.IN_TRANSIT,
    },
    items: {
      type: [stockTransferItemSchema],
      required: true,
      validate: [
        (value: unknown[]) => value.length >= 1 && value.length <= 500,
        'A transfer needs between 1 and 500 lines',
      ],
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    dispatchedAt: { type: Date },
    receivedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, maxlength: 120 },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    receivedByName: { type: String, maxlength: 120 },
  },
  { timestamps: true },
);

stockTransferSchema.index({ organizationId: 1, number: 1 }, { unique: true });
// "What is on its way to me?" - the destination branch's inbox.
stockTransferSchema.index({ organizationId: 1, toBranchId: 1, status: 1, createdAt: -1 });
stockTransferSchema.index({ organizationId: 1, fromBranchId: 1, createdAt: -1 });

stockTransferSchema.plugin(tenantGuard);

export const StockTransfer = model<IStockTransfer>('StockTransfer', stockTransferSchema);
