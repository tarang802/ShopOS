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
  OPENING_STOCK: 'OPENING_STOCK',
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  SALE_RETURN: 'SALE_RETURN',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  DAMAGE: 'DAMAGE',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
} as const;

export type InventoryTransactionType =
  (typeof INVENTORY_TRANSACTION_TYPES)[keyof typeof INVENTORY_TRANSACTION_TYPES];

/** Movement types that add stock. Everything else removes it. */
export const INBOUND_TRANSACTION_TYPES: readonly InventoryTransactionType[] = [
  INVENTORY_TRANSACTION_TYPES.OPENING_STOCK,
  INVENTORY_TRANSACTION_TYPES.PURCHASE,
  INVENTORY_TRANSACTION_TYPES.SALE_RETURN,
  INVENTORY_TRANSACTION_TYPES.TRANSFER_IN,
];

/**
 * Why a stock figure was corrected by hand.
 *
 * Adjustments always carry a reason. Without a legitimate way to correct a
 * count, staff invent illegitimate ones - such as ringing up a fake sale.
 */
export const ADJUSTMENT_REASONS = {
  PHYSICAL_COUNT: 'PHYSICAL_COUNT',
  DAMAGE: 'DAMAGE',
  THEFT: 'THEFT',
  EXPIRY: 'EXPIRY',
  SAMPLE: 'SAMPLE',
  DATA_ENTRY_ERROR: 'DATA_ENTRY_ERROR',
  OTHER: 'OTHER',
} as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[keyof typeof ADJUSTMENT_REASONS];

export const STOCK_TRANSFER_STATUSES = {
  DRAFT: 'DRAFT',
  /** Goods have left the source branch but not yet arrived. Belongs to neither. */
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;

export type StockTransferStatus =
  (typeof STOCK_TRANSFER_STATUSES)[keyof typeof STOCK_TRANSFER_STATUSES];

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

/**
 * Default price lists seeded for a new organization.
 *
 * These three are what almost every Indian wholesale or retail shop already
 * thinks in: counter rate, bulk rate, and the rate given to regular trade
 * buyers. Owners may add more.
 */
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

/** How a user proved who they are. */
export const AUTH_PROVIDERS = {
  PASSWORD: 'PASSWORD',
  GOOGLE: 'GOOGLE',
} as const;

export type AuthProvider = (typeof AUTH_PROVIDERS)[keyof typeof AUTH_PROVIDERS];

/**
 * Audited actions. Every entry records who, what, when, which organization,
 * which entity, and where it matters the before and after values.
 */
export const AUDIT_ACTIONS = {
  ORGANIZATION_CREATED: 'ORGANIZATION_CREATED',
  ORGANIZATION_UPDATED: 'ORGANIZATION_UPDATED',
  BRANCH_CREATED: 'BRANCH_CREATED',
  BRANCH_UPDATED: 'BRANCH_UPDATED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  MEMBERSHIP_CREATED: 'MEMBERSHIP_CREATED',
  MEMBERSHIP_UPDATED: 'MEMBERSHIP_UPDATED',
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  ROLE_DELETED: 'ROLE_DELETED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
  BRAND_CREATED: 'BRAND_CREATED',
  BRAND_UPDATED: 'BRAND_UPDATED',
  UNIT_CREATED: 'UNIT_CREATED',
  UNIT_UPDATED: 'UNIT_UPDATED',
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_ARCHIVED: 'PRODUCT_ARCHIVED',
  PRICE_LIST_CREATED: 'PRICE_LIST_CREATED',
  PRICE_LIST_UPDATED: 'PRICE_LIST_UPDATED',
  PRICE_CREATED: 'PRICE_CREATED',
  PRICE_UPDATED: 'PRICE_UPDATED',
  PRICE_DELETED: 'PRICE_DELETED',
  INVENTORY_ADJUSTED: 'INVENTORY_ADJUSTED',
  OPENING_STOCK_SET: 'OPENING_STOCK_SET',
  STOCK_TRANSFER_CREATED: 'STOCK_TRANSFER_CREATED',
  STOCK_TRANSFER_RECEIVED: 'STOCK_TRANSFER_RECEIVED',
  STOCK_TRANSFER_CANCELLED: 'STOCK_TRANSFER_CANCELLED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
