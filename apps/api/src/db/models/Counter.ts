import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * Atomic sequence numbers, one row per counter per organization.
 *
 * WHY not `count() + 1`: two staff members saving at the same moment would both
 * read the same count and both produce ADJ-000042. Duplicate document numbers in
 * a business record are a genuine problem - they break reconciliation and look
 * like fraud in an audit.
 *
 * `findOneAndUpdate` with `$inc` is a single atomic operation inside MongoDB, so
 * two callers are guaranteed different numbers even without a transaction.
 */

export interface ICounter {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** e.g. "ADJ-2026", "TRF-2026", "SKU". Scoped per organization. */
  key: string;
  value: number;
}

const counterSchema = new Schema<ICounter>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    key: { type: String, required: true, trim: true, maxlength: 40 },
    value: { type: Number, required: true, default: 0 },
  },
  { timestamps: false },
);

counterSchema.index({ organizationId: 1, key: 1 }, { unique: true });

counterSchema.plugin(tenantGuard);

export const Counter = model<ICounter>('Counter', counterSchema);
