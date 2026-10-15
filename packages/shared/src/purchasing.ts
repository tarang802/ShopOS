import { PAYABLE_STATUSES, type PayableStatus } from './enums';
import type { Paise } from './money';

/**
 * What the business owes a supplier for a purchase order.
 *
 * Shared by the API and the web app for the same reason as the invoice
 * arithmetic: the figure on screen must be the figure the server enforces.
 *
 * Three different amounts matter, and they are easy to confuse:
 *
 *  - the order total is what was agreed;
 *  - what is OWED is the value of goods actually received, less any sent back,
 *    less what has been paid - ordering something does not make it a debt;
 *  - what may still be PAID is bounded by the order total, so a deposit against a
 *    big order is possible but overpaying one is not.
 */

export interface PurchaseAmounts {
  totalPaise: Paise;
  /** Value of goods received so far, at the order's unit prices. */
  receivedValuePaise?: Paise;
  /** Value of goods sent back to the supplier. */
  returnedPaise?: Paise;
  paidPaise?: Paise;
}

/** What is due to the supplier right now. Never negative. */
export function purchaseOwedPaise(po: PurchaseAmounts): Paise {
  const received = po.receivedValuePaise ?? 0;
  const returned = po.returnedPaise ?? 0;
  const paid = po.paidPaise ?? 0;
  return Math.max(0, received - returned - paid);
}

/** The most that can still be paid against this order. */
export function purchasePayableCapPaise(po: PurchaseAmounts): Paise {
  const returned = po.returnedPaise ?? 0;
  const paid = po.paidPaise ?? 0;
  return Math.max(0, po.totalPaise - returned - paid);
}

/** Paid more than the order is worth after returns: the supplier owes the business. */
export function purchaseCreditDuePaise(po: PurchaseAmounts): Paise {
  const returned = po.returnedPaise ?? 0;
  const paid = po.paidPaise ?? 0;
  return Math.max(0, paid - (po.totalPaise - returned));
}

export function derivePayableStatus(po: PurchaseAmounts): PayableStatus {
  const paid = po.paidPaise ?? 0;
  const net = po.totalPaise - (po.returnedPaise ?? 0);
  if (net <= 0 || paid >= net) return PAYABLE_STATUSES.PAID;
  if (paid > 0) return PAYABLE_STATUSES.PARTIALLY_PAID;
  return PAYABLE_STATUSES.UNPAID;
}
