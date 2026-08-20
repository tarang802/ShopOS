import type { ClientSession, Types } from 'mongoose';
import type { AuditAction } from '@shopos/shared';
import { AuditLog } from '../db/models';
import { sessionOption } from '../db/transaction';
import type { TenantContext } from '../core/tenantContext';
import { logger } from '../core/logger';

/**
 * Recording who changed what.
 *
 * Called from services, never from controllers - a change made by a background
 * job or a future mobile client must be audited on exactly the same path as one
 * made through the web app.
 */

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId?: Types.ObjectId;
  entityLabel?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  branchId?: Types.ObjectId;
}

/**
 * Keep only the fields that actually changed.
 *
 * WHY not store both documents whole: audit logs are among the fastest-growing
 * collections in the system, and a full before/after snapshot on every edit
 * multiplies their size for no extra insight. "taxRatePercent: 12 -> 18" is what
 * an owner wants to see; the forty unchanged fields around it are noise.
 */
export function diffFields(
  before: object,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const previous = before as Record<string, unknown>;
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  for (const [key, nextValue] of Object.entries(after)) {
    const previousValue = previous[key];
    if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) continue;
    changedBefore[key] = previousValue;
    changedAfter[key] = nextValue;
  }

  if (Object.keys(changedAfter).length === 0) return null;
  return { before: changedBefore, after: changedAfter };
}

/**
 * Write one audit entry.
 *
 * A failure here is logged but never thrown. The reasoning: if the audit write
 * fails after a price has already been saved, throwing would show the owner an
 * error for an operation that in fact succeeded, and they would do it again. A
 * missing log line is recoverable; a duplicated price change is confusing. The
 * failure is logged at error level so it is visible rather than silent.
 */
export async function recordAudit(
  ctx: TenantContext,
  input: AuditInput,
  session?: ClientSession,
): Promise<void> {
  try {
    await AuditLog.create(
      [
        {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          userName: ctx.userName,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          ...input,
        },
      ],
      { ...sessionOption(session) },
    );
  } catch (error) {
    logger.error({ err: error, action: input.action }, 'Failed to write audit log');
  }
}
