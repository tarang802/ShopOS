/**
 * ShopOS permission registry.
 *
 * WHAT: the single, authoritative list of every action a user can be granted.
 *
 * WHY: authorization is permission-based, never role-based. Code must never ask
 * "is this user an OWNER?" - it asks "does this user hold products:update?".
 * Roles are just named bundles of permissions, and an organization can invent
 * its own roles without a single line of backend code changing.
 *
 * HOW: the backend enforces these in middleware on every protected route. The
 * frontend imports the same constants purely to hide buttons the user cannot
 * use. Frontend checks are cosmetic; the backend check is the real one.
 */

export const PERMISSIONS = {
  // Catalogue
  PRODUCTS_VIEW: 'products:view',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_ARCHIVE: 'products:archive',

  // Pricing - deliberately separate from products, because seeing a product is
  // routine while changing what it sells for is the owner's decision.
  PRICING_VIEW: 'pricing:view',
  PRICING_CREATE: 'pricing:create',
  PRICING_UPDATE: 'pricing:update',
  PRICING_DELETE: 'pricing:delete',

  // Inventory
  INVENTORY_VIEW: 'inventory:view',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_TRANSFER: 'inventory:transfer',

  // Purchasing
  PURCHASES_VIEW: 'purchases:view',
  PURCHASES_CREATE: 'purchases:create',
  PURCHASES_UPDATE: 'purchases:update',
  PURCHASES_RECEIVE: 'purchases:receive',

  // Sales
  SALES_VIEW: 'sales:view',
  SALES_CREATE: 'sales:create',
  SALES_UPDATE: 'sales:update',
  SALES_CANCEL: 'sales:cancel',
  SALES_DISCOUNT_OVERRIDE: 'sales:discount_override',

  // Parties
  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_MANAGE: 'customers:manage',
  SUPPLIERS_VIEW: 'suppliers:view',
  SUPPLIERS_MANAGE: 'suppliers:manage',

  // Finance
  PAYMENTS_VIEW: 'payments:view',
  PAYMENTS_CREATE: 'payments:create',

  // Reporting
  REPORTS_VIEW: 'reports:view',

  // Administration
  USERS_VIEW: 'users:view',
  USERS_MANAGE: 'users:manage',
  ROLES_MANAGE: 'roles:manage',
  BRANCHES_VIEW: 'branches:view',
  BRANCHES_MANAGE: 'branches:manage',
  ORGANIZATION_MANAGE: 'organization:manage',
  AUDIT_LOGS_VIEW: 'audit_logs:view',
} as const;

/** Union of every valid permission string, derived from the registry above. */
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Flat array of every permission, useful for seeding and validation. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * System role templates.
 *
 * These are seeded into each new organization as real, editable role documents.
 * They are starting points, not hard-coded behaviour - an owner can change what
 * MANAGER means for their business without touching ShopOS itself.
 */
export const SYSTEM_ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  SALES_STAFF: 'SALES_STAFF',
  INVENTORY_STAFF: 'INVENTORY_STAFF',
  ACCOUNTANT: 'ACCOUNTANT',
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

const P = PERMISSIONS;

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  // The owner holds everything, including the right to hand out permissions.
  OWNER: ALL_PERMISSIONS,

  // Full operations, but cannot restructure the organization itself.
  ADMIN: ALL_PERMISSIONS.filter((p) => p !== P.ORGANIZATION_MANAGE),

  // Runs one or more branches. Sees pricing, cannot rewrite it.
  MANAGER: [
    P.PRODUCTS_VIEW, P.PRODUCTS_CREATE, P.PRODUCTS_UPDATE,
    P.PRICING_VIEW,
    P.INVENTORY_VIEW, P.INVENTORY_ADJUST, P.INVENTORY_TRANSFER,
    P.PURCHASES_VIEW, P.PURCHASES_CREATE, P.PURCHASES_UPDATE, P.PURCHASES_RECEIVE,
    P.SALES_VIEW, P.SALES_CREATE, P.SALES_UPDATE, P.SALES_CANCEL,
    P.CUSTOMERS_VIEW, P.CUSTOMERS_MANAGE,
    P.SUPPLIERS_VIEW, P.SUPPLIERS_MANAGE,
    P.PAYMENTS_VIEW, P.PAYMENTS_CREATE,
    P.REPORTS_VIEW,
    P.USERS_VIEW, P.BRANCHES_VIEW,
  ],

  // The counter staff this product exists for: look up prices, sell.
  SALES_STAFF: [
    P.PRODUCTS_VIEW,
    P.PRICING_VIEW,
    P.INVENTORY_VIEW,
    P.SALES_VIEW, P.SALES_CREATE,
    P.CUSTOMERS_VIEW, P.CUSTOMERS_MANAGE,
    P.PAYMENTS_VIEW, P.PAYMENTS_CREATE,
  ],

  // Moves goods. Has no reason to see or change what things sell for.
  INVENTORY_STAFF: [
    P.PRODUCTS_VIEW,
    P.INVENTORY_VIEW, P.INVENTORY_ADJUST, P.INVENTORY_TRANSFER,
    P.PURCHASES_VIEW, P.PURCHASES_RECEIVE,
    P.SUPPLIERS_VIEW,
  ],

  // Money in and out, plus the reports that explain it. Read-only elsewhere.
  ACCOUNTANT: [
    P.PRODUCTS_VIEW,
    P.PRICING_VIEW,
    P.INVENTORY_VIEW,
    P.PURCHASES_VIEW,
    P.SALES_VIEW,
    P.CUSTOMERS_VIEW, P.SUPPLIERS_VIEW,
    P.PAYMENTS_VIEW, P.PAYMENTS_CREATE,
    P.REPORTS_VIEW,
    P.AUDIT_LOGS_VIEW,
  ],
};
