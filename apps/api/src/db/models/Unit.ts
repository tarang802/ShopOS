import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * How a product is counted: piece, box, dozen, kilogram, litre, metre.
 *
 * `allowsDecimal` matters in practice. You can sell 2.5 kg of nails; you cannot
 * sell 2.5 pencils. The inventory service uses this to reject a fractional
 * quantity on a whole-unit product before it ever reaches the ledger.
 */

export interface IUnit {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  /** Short form shown in tables and on documents: pcs, box, kg. */
  symbol: string;
  allowsDecimal: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const unitSchema = new Schema<IUnit>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    symbol: { type: String, required: true, trim: true, maxlength: 12 },
    allowsDecimal: { type: Boolean, required: true, default: false },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

unitSchema.index({ organizationId: 1, name: 1 }, { unique: true });

unitSchema.plugin(tenantGuard);

export const Unit = model<IUnit>('Unit', unitSchema);
