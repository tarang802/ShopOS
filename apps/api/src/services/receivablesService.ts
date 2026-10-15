import type { ClientSession, Types } from 'mongoose';
import { INVOICE_STATUSES } from '@shopos/shared';
import { Invoice } from '../db/models';
import { orgFilter, type TenantContext } from '../core/tenantContext';

/**
 * What customers owe.
 *
 * Outstanding is never stored. It is the invoice total less returns, less what
 * has been paid net of any refund - the same formula `invoiceOutstandingPaise`
 * applies to a single document in `@shopos/shared`, written here as an
 * aggregation so the database can add it up across thousands of invoices
 * without shipping them to Node.
 */

/** The aggregation expression for one invoice's outstanding amount, never below zero. */
export const OUTSTANDING_EXPRESSION = {
  $max: [
    0,
    {
      $subtract: [
        { $subtract: ['$totalPaise', { $ifNull: ['$returnedPaise', 0] }] },
        { $subtract: ['$paidPaise', { $ifNull: ['$refundedPaise', 0] }] },
      ],
    },
  ],
} as const;

/**
 * A filter value that matches an amount which may be missing altogether.
 *
 * Invoices written before returns existed have no returnedPaise or refundedPaise,
 * and `{ returnedPaise: 0 }` does not match a missing field - so a compare-and-swap
 * on such an invoice would never match and the payment would be refused forever.
 */
export function amountMatches(value: number | undefined): number | { $in: (number | null)[] } {
  const amount = value ?? 0;
  return amount === 0 ? { $in: [0, null] } : amount;
}

/** Invoices that can still have money collected against them. */
export const OPEN_INVOICE_STATUSES = [
  INVOICE_STATUSES.ISSUED,
  INVOICE_STATUSES.PARTIALLY_PAID,
] as const;

export async function customerOutstandingPaise(
  ctx: TenantContext,
  customerId: Types.ObjectId,
  session?: ClientSession,
): Promise<number> {
  const rows = await Invoice.aggregate<{ total: number }>([
    {
      $match: {
        ...orgFilter(ctx),
        customerId,
        status: { $in: [...OPEN_INVOICE_STATUSES] },
      },
    },
    { $group: { _id: null, total: { $sum: OUTSTANDING_EXPRESSION } } },
  ]).session(session ?? null);

  return rows[0]?.total ?? 0;
}
