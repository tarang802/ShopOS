import type { ClientSession, Types } from 'mongoose';
import {
  DEFAULT_PRICE_LIST_CODES,
  MEMBERSHIP_STATUSES,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  type SystemRole,
} from '@shopos/shared';
import { Branch, Membership, Organization, PriceList, Role, Unit } from '../db/models';
import { sessionOption } from '../db/transaction';

/**
 * Everything a new business needs on its first day.
 *
 * WHY seed rather than start empty: an owner who signs up and lands on a screen
 * demanding they first define a "unit of measure" and a "price list" will close
 * the tab. The defaults below are what a stationery, hardware or grocery shop in
 * India already uses, so the first thing they do is add a product - the thing
 * they actually came for.
 *
 * Everything seeded is ordinary editable data. Nothing here is special-cased in
 * code later, so an owner can rename, add or deactivate any of it.
 */

/** Units that cover the great majority of Indian wholesale and retail trade. */
const DEFAULT_UNITS: { name: string; symbol: string; allowsDecimal: boolean }[] = [
  { name: 'Piece', symbol: 'pcs', allowsDecimal: false },
  { name: 'Box', symbol: 'box', allowsDecimal: false },
  { name: 'Packet', symbol: 'pkt', allowsDecimal: false },
  { name: 'Dozen', symbol: 'dzn', allowsDecimal: false },
  { name: 'Bundle', symbol: 'bdl', allowsDecimal: false },
  { name: 'Bag', symbol: 'bag', allowsDecimal: false },
  { name: 'Kilogram', symbol: 'kg', allowsDecimal: true },
  { name: 'Gram', symbol: 'g', allowsDecimal: true },
  { name: 'Litre', symbol: 'ltr', allowsDecimal: true },
  { name: 'Metre', symbol: 'mtr', allowsDecimal: true },
  { name: 'Feet', symbol: 'ft', allowsDecimal: true },
];

const SYSTEM_ROLE_LABELS: Record<SystemRole, { name: string; description: string }> = {
  OWNER: { name: 'Owner', description: 'Full control of the business, including rates and staff' },
  ADMIN: { name: 'Admin', description: 'Runs day-to-day operations across all branches' },
  MANAGER: {
    name: 'Manager',
    description: 'Runs assigned branches. Can see rates but not change them',
  },
  SALES_STAFF: {
    name: 'Sales Staff',
    description: 'Looks up rates and stock, and makes sales at the counter',
  },
  INVENTORY_STAFF: {
    name: 'Inventory Staff',
    description: 'Receives goods, adjusts and transfers stock. Cannot see rates',
  },
  ACCOUNTANT: {
    name: 'Accountant',
    description: 'Payments, outstanding amounts and reports. Read-only elsewhere',
  },
};

const DEFAULT_PRICE_LISTS = [
  {
    code: DEFAULT_PRICE_LIST_CODES.RETAIL,
    name: 'Retail',
    description: 'Counter rate for walk-in customers',
    displayOrder: 1,
    isDefault: true,
  },
  {
    code: DEFAULT_PRICE_LIST_CODES.WHOLESALE,
    name: 'Wholesale',
    description: 'Bulk rate for shopkeepers and bulk buyers',
    displayOrder: 2,
    isDefault: false,
  },
  {
    code: DEFAULT_PRICE_LIST_CODES.DEALER,
    name: 'Dealer',
    description: 'Rate for regular trade buyers and distributors',
    displayOrder: 3,
    isDefault: false,
  },
];

export interface BootstrapResult {
  branchId: Types.ObjectId;
  ownerRoleId: Types.ObjectId;
  membershipId: Types.ObjectId;
  defaultPriceListId: Types.ObjectId;
}

export async function bootstrapOrganization(
  organizationId: Types.ObjectId,
  ownerUserId: Types.ObjectId,
  options: { branchName?: string; city?: string },
  session?: ClientSession,
): Promise<BootstrapResult> {
  const opts = sessionOption(session);

  // 1. The head branch. Every business has at least one place that holds stock,
  //    so it is created up front rather than being another empty screen.
  const [branch] = await Branch.create(
    [
      {
        organizationId,
        name: options.branchName?.trim() || 'Main Branch',
        code: 'MAIN',
        city: options.city,
        isMain: true,
      },
    ],
    opts,
  );

  // 2. The six starting roles, seeded as ordinary documents so the owner can
  //    reshape them to how their business actually runs.
  const roles = await Role.create(
    (Object.keys(SYSTEM_ROLE_LABELS) as SystemRole[]).map((code) => ({
      organizationId,
      code,
      name: SYSTEM_ROLE_LABELS[code].name,
      description: SYSTEM_ROLE_LABELS[code].description,
      permissions: [...SYSTEM_ROLE_PERMISSIONS[code]],
      isSystem: true,
    })),
    opts,
  );

  const ownerRole = roles.find((role) => role.code === SYSTEM_ROLES.OWNER);
  if (!ownerRole) throw new Error('Owner role was not created during bootstrap');

  // 3. The three rate types every Indian shop already thinks in.
  const priceLists = await PriceList.create(
    DEFAULT_PRICE_LISTS.map((list) => ({ organizationId, ...list })),
    opts,
  );
  const retailList = priceLists.find(
    (list) => list.code === DEFAULT_PRICE_LIST_CODES.RETAIL,
  );
  if (!retailList) throw new Error('Retail price list was not created during bootstrap');

  // 4. Units of measure.
  await Unit.create(
    DEFAULT_UNITS.map((unit) => ({ organizationId, ...unit })),
    opts,
  );

  // 5. The owner's membership. `allBranches` is true so branches created later
  //    are automatically theirs, without anyone remembering to grant them.
  const [membership] = await Membership.create(
    [
      {
        organizationId,
        userId: ownerUserId,
        roleId: ownerRole._id,
        allBranches: true,
        branchIds: [],
        status: MEMBERSHIP_STATUSES.ACTIVE,
        joinedAt: new Date(),
      },
    ],
    opts,
  );

  // 6. Point the organization at its default rate list.
  await Organization.updateOne(
    { _id: organizationId },
    { $set: { 'settings.defaultPriceListId': retailList._id } },
    opts,
  );

  if (!branch || !membership) throw new Error('Organization bootstrap did not complete');

  return {
    branchId: branch._id,
    ownerRoleId: ownerRole._id,
    membershipId: membership._id,
    defaultPriceListId: retailList._id,
  };
}
