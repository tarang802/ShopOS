import { Schema, Types, model } from 'mongoose';

/**
 * An organization is one business - "Gupta Traders", "Sharma Hardware".
 *
 * It is the tenant root. Every other organization-owned document points back
 * here, and no query may cross from one organization to another.
 *
 * This collection is deliberately NOT tenant-guarded: it is looked up by its own
 * _id, which is how a tenant is identified in the first place.
 */

export interface IOrganizationSettings {
  /**
   * Whether stock may go below zero.
   *
   * Off by default. Many shops do sell goods that are physically present but not
   * yet entered, so the escape hatch exists - but it is a conscious choice by the
   * owner, not a silent default.
   */
  allowNegativeStock: boolean;
  /** Products at or below this quantity appear in the low-stock list. */
  lowStockThreshold: number;
  /** Price list used when none is specified, e.g. at the counter. */
  defaultPriceListId?: Types.ObjectId;
}

export interface IOrganization {
  _id: Types.ObjectId;
  name: string;
  /** URL-safe handle, unique across the platform. */
  slug: string;
  /** Stationery, Hardware, Electrical, Medical, Grocery and so on. */
  businessType?: string;
  /** Stored for the record only. There is no GST compliance engine in v1. */
  gstin?: string;
  phone?: string;
  email?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  currency: string;
  timezone: string;
  settings: IOrganizationSettings;
  isActive: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    businessType: { type: String, trim: true, maxlength: 60 },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 20 },
    phone: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    addressLine: { type: String, trim: true, maxlength: 240 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    pincode: { type: String, trim: true, maxlength: 10 },
    currency: { type: String, required: true, default: 'INR', uppercase: true, maxlength: 3 },
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    settings: {
      allowNegativeStock: { type: Boolean, required: true, default: false },
      lowStockThreshold: { type: Number, required: true, default: 10, min: 0 },
      defaultPriceListId: { type: Schema.Types.ObjectId, ref: 'PriceList' },
    },
    isActive: { type: Boolean, required: true, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

export const Organization = model<IOrganization>('Organization', organizationSchema);
