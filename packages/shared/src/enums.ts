/**
 * Business vocabulary shared by the API and the web client.
 *
 * These are declared once so a status string can never be spelled two ways.
 */

/**
 * Every way stock can move. Written to the inventory ledger, never edited.
 * The current stock figure is the sum of these events, which is what makes
 * inventory explainable rather than merely numeric.
 */
export const INVENTORY_TRANSACTION_TYPES = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  SALE_RETURN: 'SALE_RETURN',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  DAMAGE: 'DAMAGE',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  OPENING_STOCK: 'OPENING_STOCK',
} as const;

export type InventoryTransactionType =
  (typeof INVENTORY_TRANSACTION_TYPES)[keyof typeof INVENTORY_TRANSACTION_TYPES];

export const PURCHASE_ORDER_STATUSES = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;

export type PurchaseOrderStatus =
  (typeof PURCHASE_ORDER_STATUSES)[keyof typeof PURCHASE_ORDER_STATUSES];

export const QUOTATION_STATUSES = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CONVERTED: 'CONVERTED',
} as const;

export type QuotationStatus = (typeof QUOTATION_STATUSES)[keyof typeof QUOTATION_STATUSES];

export const SALES_ORDER_STATUSES = {
  DRAFT: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
  PARTIALLY_INVOICED: 'PARTIALLY_INVOICED',
  INVOICED: 'INVOICED',
  CANCELLED: 'CANCELLED',
} as const;

export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[keyof typeof SALES_ORDER_STATUSES];

export const INVOICE_STATUSES = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[keyof typeof INVOICE_STATUSES];

export const STOCK_TRANSFER_STATUSES = {
  DRAFT: 'DRAFT',
  /** Goods have left the source branch but not yet arrived. Belongs to neither. */
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;

export type StockTransferStatus =
  (typeof STOCK_TRANSFER_STATUSES)[keyof typeof STOCK_TRANSFER_STATUSES];

/** Default price lists seeded for a new organization. Owners may add more. */
export const DEFAULT_PRICE_LIST_CODES = {
  RETAIL: 'RETAIL',
  WHOLESALE: 'WHOLESALE',
  DEALER: 'DEALER',
} as const;

export const PAYMENT_METHODS = {
  CASH: 'CASH',
  UPI: 'UPI',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CARD: 'CARD',
  CHEQUE: 'CHEQUE',
  CREDIT: 'CREDIT',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

export const MEMBERSHIP_STATUSES = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[keyof typeof MEMBERSHIP_STATUSES];
