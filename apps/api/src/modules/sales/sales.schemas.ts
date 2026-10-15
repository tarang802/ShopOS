import { z } from 'zod';
import {
  PAYMENT_METHODS,
  objectIdSchema,
  paiseSchema,
  percentSchema,
  positiveQuantitySchema,
} from '@shopos/shared';

/**
 * Request shapes shared by invoices, quotations and sales orders.
 *
 * Declared once because they describe the same thing - a line being sold - and a
 * rule changed in one place (the quantity precision, say) must change everywhere.
 */

export const lineInputSchema = z.object({
  productId: objectIdSchema,
  quantity: positiveQuantitySchema,
  priceListId: objectIdSchema.optional(),
  discountPercent: percentSchema.optional(),
  overrideUnitPricePaise: paiseSchema.optional(),
});

export const linesSchema = z
  .array(lineInputSchema)
  .min(1, 'Add at least one product')
  .max(500)
  .superRefine((lines, ctx) => {
    const seen = new Set<string>();
    for (const [index, line] of lines.entries()) {
      if (seen.has(line.productId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'productId'],
          message: 'This product is already on the document. Combine the quantities',
        });
      }
      seen.add(line.productId);
    }
  });

export const paymentInputSchema = z.object({
  method: z.enum(Object.values(PAYMENT_METHODS) as [string, ...string[]]),
  amountPaise: paiseSchema.refine((value) => value > 0, 'Amount must be more than zero'),
  reference: z.string().trim().max(60).optional(),
});

/** Date range filters as they arrive in a query string. */
export const dateRangeQuery = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

/** A query string carries booleans as text, and z.coerce.boolean() turns "false" into true. */
export const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

/** The last instant of the chosen day, so a range includes its final day whole. */
export function endOfRange(date: Date): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}
