import { Schema, Types } from 'mongoose';

/**
 * The line shared by quotations and sales orders.
 *
 * Like an invoice line, it freezes the product's name, code, unit, rate,
 * discount and tax at the moment the price was committed. A quotation honoured
 * a fortnight later still shows - and charges - what was quoted, whatever has
 * happened to the rate card since.
 */

export interface IDocumentLine {
  productId: Types.ObjectId;
  productName: string;
  sku: string;
  unitSymbol: string;
  quantity: number;
  unitPricePaise: number;
  /** quantity x unit price, before any discount. */
  grossPaise: number;
  discountPercent: number;
  discountPaise: number;
  taxRatePercent: number;
  /** gross less discount, before tax. */
  subtotalPaise: number;
  taxPaise: number;
  lineTotalPaise: number;
}

export const documentLineFields = {
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true, maxlength: 200 },
  sku: { type: String, required: true, maxlength: 40 },
  unitSymbol: { type: String, required: true, maxlength: 12 },
  quantity: { type: Number, required: true, min: 0 },
  unitPricePaise: { type: Number, required: true, min: 0 },
  grossPaise: { type: Number, required: true, min: 0 },
  discountPercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
  discountPaise: { type: Number, required: true, default: 0, min: 0 },
  taxRatePercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
  subtotalPaise: { type: Number, required: true, min: 0 },
  taxPaise: { type: Number, required: true, min: 0 },
  lineTotalPaise: { type: Number, required: true, min: 0 },
} as const;

export const documentLineSchema = new Schema<IDocumentLine>(documentLineFields, { _id: false });

export function validLineCount(value: unknown[]): boolean {
  return value.length >= 1 && value.length <= 500;
}
