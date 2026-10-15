import { PERMISSIONS, SYSTEM_ROLES, ALL_PERMISSIONS, type Permission } from '@shopos/shared';
import { Migration, Role } from './models';
import { logger } from '../core/logger';

/**
 * One-off data changes that must reach businesses that already exist.
 *
 * WHY this is needed: roles are stored as data per business, seeded once at
 * signup. A permission added to the codebase later never reaches a business
 * that signed up before it existed - its OWNER would be missing a permission
 * and could not hand it to anyone. New businesses get the new defaults from the
 * bootstrap; existing ones get them from here.
 *
 * Each migration runs once and is recorded. Recording matters because the grants
 * are applied with `$addToSet`: if an owner deliberately removes a permission
 * from MANAGER, running the grant again on every boot would silently put it back.
 *
 * Every migration must be idempotent, because two API instances starting at the
 * same moment can both run it before either records it.
 */

interface MigrationDefinition {
  id: string;
  description: string;
  up: () => Promise<void>;
}

const P = PERMISSIONS;

/** The permissions introduced with returns, voiding, supplier payments and costs. */
const PHASE_13_GRANTS: Record<string, readonly Permission[]> = {
  [SYSTEM_ROLES.OWNER]: ALL_PERMISSIONS,
  [SYSTEM_ROLES.ADMIN]: [
    P.SALES_RETURN,
    P.PAYMENTS_VOID,
    P.PURCHASES_PAY,
    P.PURCHASES_RETURN,
    P.COSTS_VIEW,
  ],
  [SYSTEM_ROLES.MANAGER]: [P.SALES_RETURN, P.PURCHASES_PAY, P.PURCHASES_RETURN, P.COSTS_VIEW],
  [SYSTEM_ROLES.INVENTORY_STAFF]: [P.PURCHASES_RETURN],
  [SYSTEM_ROLES.ACCOUNTANT]: [P.PAYMENTS_VOID, P.PURCHASES_PAY, P.COSTS_VIEW],
};

async function grantPermissions(grants: Record<string, readonly Permission[]>): Promise<void> {
  for (const [code, permissions] of Object.entries(grants)) {
    await Role.updateMany(
      { code, isSystem: true },
      { $addToSet: { permissions: { $each: [...permissions] } } },
    ).setOptions({ allowCrossTenant: true });
  }
}

export const MIGRATIONS: readonly MigrationDefinition[] = [
  {
    id: '2026-10-grant-returns-voids-supplier-payments-costs',
    description: 'Grant the returns, payment-void, supplier-payment and cost permissions to the starting roles',
    up: () => grantPermissions(PHASE_13_GRANTS),
  },
];

export async function runMigrations(): Promise<void> {
  for (const migration of MIGRATIONS) {
    const done = await Migration.exists({ _id: migration.id });
    if (done) continue;

    logger.info({ migration: migration.id }, 'Running data migration');
    await migration.up();
    await Migration.updateOne(
      { _id: migration.id },
      { $setOnInsert: { description: migration.description, appliedAt: new Date() } },
      { upsert: true },
    );
  }
}
