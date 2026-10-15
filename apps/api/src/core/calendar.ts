import { calendarRange } from '@shopos/shared';
import { Organization } from '../db/models';
import type { TenantContext } from './tenantContext';

/**
 * The instants covered by a "from" and "to" date typed into a filter.
 *
 * Dates are calendar days in the shop's own timezone: "to 31 Oct" must include an
 * invoice raised at 11pm in Kolkata, which is already 1 Nov in UTC. Either end may be
 * left open.
 */
export async function organizationDayRange(
  ctx: TenantContext,
  from?: Date,
  to?: Date,
): Promise<{ $gte?: Date; $lte?: Date } | undefined> {
  if (!from && !to) return undefined;

  const organization = await Organization.findById(ctx.organizationId).select('timezone').lean();
  const range = calendarRange(from, to, organization?.timezone ?? 'Asia/Kolkata');

  return {
    ...(range.from ? { $gte: range.from } : {}),
    ...(range.to ? { $lte: range.to } : {}),
  };
}
