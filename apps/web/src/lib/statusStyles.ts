/**
 * How each status of each document is worded and coloured.
 *
 * Declared once because the same status appears in lists, on detail pages and on the
 * dashboard, and "Partially paid" must not be amber in one and blue in another.
 */

export type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive' | 'outline';

export interface StatusStyle {
  label: string;
  variant: BadgeVariant;
}

export const INVOICE_STATUS: Record<string, StatusStyle> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  ISSUED: { label: 'Unpaid', variant: 'default' },
  PARTIALLY_PAID: { label: 'Partly paid', variant: 'warning' },
  PAID: { label: 'Paid', variant: 'success' },
  RETURNED: { label: 'Returned', variant: 'outline' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

export const PAYMENT_STATUS: Record<string, StatusStyle> = {
  RECORDED: { label: 'Recorded', variant: 'success' },
  VOIDED: { label: 'Voided', variant: 'destructive' },
};

export const QUOTATION_STATUS: Record<string, StatusStyle> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  SENT: { label: 'Sent', variant: 'default' },
  ACCEPTED: { label: 'Accepted', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  EXPIRED: { label: 'Expired', variant: 'warning' },
  CONVERTED: { label: 'Converted', variant: 'success' },
};

export const SALES_ORDER_STATUS: Record<string, StatusStyle> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  CONFIRMED: { label: 'Confirmed', variant: 'default' },
  PARTIALLY_INVOICED: { label: 'Partly invoiced', variant: 'warning' },
  INVOICED: { label: 'Invoiced', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

export const PURCHASE_STATUS: Record<string, StatusStyle> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  SENT: { label: 'Sent', variant: 'default' },
  PARTIALLY_RECEIVED: { label: 'Partly received', variant: 'warning' },
  RECEIVED: { label: 'Received', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

export const PAYABLE_STATUS: Record<string, StatusStyle> = {
  UNPAID: { label: 'Unpaid', variant: 'default' },
  PARTIALLY_PAID: { label: 'Partly paid', variant: 'warning' },
  PAID: { label: 'Paid', variant: 'success' },
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  CHEQUE: 'Cheque',
  CREDIT: 'On credit',
};

export const RETURN_REASON_LABELS: Record<string, string> = {
  DEFECTIVE: 'Defective',
  WRONG_ITEM: 'Wrong item',
  EXCESS_QUANTITY: 'Too many supplied',
  CUSTOMER_CHANGED_MIND: 'Changed their mind',
  OTHER: 'Other',
};

export function statusOf(map: Record<string, StatusStyle>, status: string): StatusStyle {
  return map[status] ?? { label: status, variant: 'outline' };
}
