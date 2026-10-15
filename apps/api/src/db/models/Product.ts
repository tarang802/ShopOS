import { Schema, Types, model } from 'mongoose';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * The catalogue entry. This is the thing a staff member searches for.
 *
 * Two design points matter more than the rest:
 *
 * 1. There is NO `price` field. A product is priced through price lists, because
 *    the same pencil sells at one rate over the counter, another by the box, and
 *    another to a regular trade buyer. See the ProductPrice model.
 *
 * 2. Images and barcodes are embedded. Both are small, bounded, and always read
 *    with the product. A barcode scan is still served by an index, because
 *    MongoDB indexes fields inside embedded arrays (a multikey index).
 *
 * `brandName`, `categoryName` and `unitSymbol` are deliberately copied here from
 * their own collections. A search result list needs them on screen, and copying
 * avoids three extra lookups per row on the most-used screen in the product.
 * The product service refreshes them when a brand or category is renamed. This
 * is intentional duplication for read speed, not an accident.
 */

export interface IProductImage {
  url: string;
  /** Cloudinary public id, kept so the file can be deleted when detached. */
  publicId: string;
  isPrimary: boolean;
}

export interface IProductBarcode {
  code: string;
  /** EAN13, UPC, or a code the shop printed itself. */
  type?: string;
}

export interface IProduct {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  /** Item code. Unique within the organization, auto-generated when omitted. */
  sku: string;
  description?: string;

  brandId?: Types.ObjectId;
  categoryId?: Types.ObjectId;
  unitId: Types.ObjectId;

  // Denormalized for search results. Refreshed by the service on rename.
  brandName?: string;
  categoryName?: string;
  unitName: string;
  unitSymbol: string;

  barcodes: IProductBarcode[];
  images: IProductImage[];

  /**
   * A single tax percentage carried on the product, e.g. 18 for 18% GST.
   * v1 has no tax compliance engine - no HSN codes and no CGST/SGST/IGST split.
   * This is here so a rate can be recorded and shown, nothing more.
   */
  taxRatePercent: number;

  /** Below this quantity the product appears in the low-stock list. */
  reorderLevel: number;

  /**
   * What one unit costs the business, in paise - a moving average that goods
   * receipts keep current. Never selected by default: it is only read by code
   * that has first checked the caller holds `costs:view`, so a query that
   * forgets to ask cannot leak it.
   */
  costPricePaise?: number;

  /**
   * Products are archived, never deleted. Six months of invoices point at this
   * document, and those invoices must keep resolving forever.
   */
  isActive: boolean;

  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    description: { type: String, trim: true, maxlength: 2000 },

    brandId: { type: Schema.Types.ObjectId, ref: 'Brand' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', required: true },

    brandName: { type: String, trim: true, maxlength: 80 },
    categoryName: { type: String, trim: true, maxlength: 80 },
    unitName: { type: String, required: true, trim: true, maxlength: 40 },
    unitSymbol: { type: String, required: true, trim: true, maxlength: 12 },

    barcodes: {
      type: [
        new Schema<IProductBarcode>(
          {
            code: { type: String, required: true, trim: true, maxlength: 60 },
            type: { type: String, trim: true, maxlength: 20 },
          },
          { _id: false },
        ),
      ],
      default: [],
      // A product with hundreds of barcodes is a data-entry mistake, not a
      // business need. Bounded arrays keep documents small and predictable.
      validate: [(value: unknown[]) => value.length <= 20, 'At most 20 barcodes per product'],
    },

    images: {
      type: [
        new Schema<IProductImage>(
          {
            url: { type: String, required: true, maxlength: 600 },
            publicId: { type: String, required: true, maxlength: 240 },
            isPrimary: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
      validate: [(value: unknown[]) => value.length <= 8, 'At most 8 images per product'],
    },

    taxRatePercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
    reorderLevel: { type: Number, required: true, default: 0, min: 0 },
    costPricePaise: { type: Number, min: 0, select: false },
    isActive: { type: Boolean, required: true, default: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Item codes are unique per business, not globally: two shops may both use P001.
productSchema.index({ organizationId: 1, sku: 1 }, { unique: true });

// Barcode scan. Multikey index over the embedded array, so a scan is a single
// indexed lookup no matter how many barcodes a product carries.
productSchema.index({ organizationId: 1, 'barcodes.code': 1 });

// The listing screen: active products of a category or brand, alphabetical.
productSchema.index({ organizationId: 1, isActive: 1, name: 1 });
productSchema.index({ organizationId: 1, categoryId: 1, isActive: 1 });
productSchema.index({ organizationId: 1, brandId: 1, isActive: 1 });

/**
 * Full-text search over the fields staff actually type. Weights put the product
 * name first, because "Natraj" typed into the box is far more likely to mean the
 * pencil than the brand record.
 *
 * A text index scales to large catalogues in a way that a regular expression
 * cannot: `/pencil/i` cannot use an index at all and degrades linearly as the
 * catalogue grows.
 */
productSchema.index(
  { name: 'text', sku: 'text', brandName: 'text', categoryName: 'text' },
  {
    name: 'product_search',
    weights: { name: 10, sku: 6, brandName: 4, categoryName: 2 },
    default_language: 'english',
  },
);

productSchema.plugin(tenantGuard);

export const Product = model<IProduct>('Product', productSchema);
