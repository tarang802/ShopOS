import { Types } from 'mongoose';
import {
  NOTIFICATION_SEVERITIES,
  toSkip,
  type NotificationSeverity,
  type NotificationType,
  type PaginationQuery,
  type Permission,
} from '@shopos/shared';
import { Notification } from '../db/models';
import { orgFilter, type TenantContext } from '../core/tenantContext';
import { AppError } from '../core/AppError';
import { logger } from '../core/logger';

/**
 * Telling people what needs attention.
 *
 * Creating a notification must never get in the way of the work that caused it.
 * A sale that takes the last unit should not fail because the "out of stock"
 * alert could not be written, so every creation path swallows and logs its own
 * errors rather than throwing into the caller.
 */

export interface NotificationInput {
  organizationId: Types.ObjectId;
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body?: string;
  link?: string;
  requiredPermission?: Permission;
  branchId?: Types.ObjectId;
  /** Creating twice with the same key does nothing the second time. */
  dedupeKey?: string;
}

/**
 * Create notifications, skipping any whose key already exists.
 *
 * Not tied to the caller's transaction, deliberately: a unique-key collision
 * inside a transaction aborts it, and an alert is not worth failing a sale over.
 */
export async function notify(inputs: NotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;

  try {
    const operations = inputs.map((input) => {
      const document = {
        organizationId: input.organizationId,
        type: input.type,
        severity: input.severity ?? NOTIFICATION_SEVERITIES.INFO,
        title: input.title,
        ...(input.body ? { body: input.body } : {}),
        ...(input.link ? { link: input.link } : {}),
        ...(input.requiredPermission ? { requiredPermission: input.requiredPermission } : {}),
        ...(input.branchId ? { branchId: input.branchId } : {}),
        readBy: [],
        createdAt: new Date(),
      };

      // With a key, an upsert that only sets on insert makes the whole operation
      // idempotent. Without one every call is a new notification.
      return input.dedupeKey
        ? {
            updateOne: {
              filter: { organizationId: input.organizationId, dedupeKey: input.dedupeKey },
              update: { $setOnInsert: { ...document, dedupeKey: input.dedupeKey } },
              upsert: true,
            },
          }
        : { insertOne: { document } };
    });

    await Notification.bulkWrite(operations as never, { ordered: false });
  } catch (error) {
    // Two instances sweeping at once can both try to insert the same key. The
    // loser's duplicate-key error is expected and harmless.
    const duplicate = (error as { code?: number }).code === 11000;
    if (!duplicate) logger.error({ err: error }, 'Failed to create notifications');
  }
}

/** The filter for notifications this person is allowed to see. */
function visibleTo(ctx: TenantContext): Record<string, unknown> {
  const permissionClause = {
    $or: [
      { requiredPermission: { $exists: false } },
      { requiredPermission: { $in: [...ctx.permissions] } },
    ],
  };
  const branchClause = ctx.allBranches
    ? {}
    : { $or: [{ branchId: { $exists: false } }, { branchId: { $in: ctx.branchIds } }] };

  return { ...orgFilter(ctx), $and: [permissionClause, branchClause] };
}

export async function listNotifications(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: { unreadOnly?: boolean },
) {
  const filter: Record<string, unknown> = visibleTo(ctx);
  if (filters.unreadOnly) filter.readBy = { $ne: ctx.userId };

  const [rows, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  const items = rows.map(({ readBy, ...notification }) => ({
    ...notification,
    isRead: readBy.some((id) => id.equals(ctx.userId)),
  }));
  return { items, total, page: query.page, limit: query.limit };
}

/** What the bell in the header polls: how many are unread, and the newest few. */
export async function notificationSummary(ctx: TenantContext) {
  const unreadFilter = { ...visibleTo(ctx), readBy: { $ne: ctx.userId } };

  const [unreadCount, latest] = await Promise.all([
    Notification.countDocuments(unreadFilter),
    Notification.find(unreadFilter).sort({ createdAt: -1, _id: -1 }).limit(5).lean(),
  ]);

  return {
    unreadCount,
    latest: latest.map(({ readBy: _readBy, ...notification }) => ({ ...notification, isRead: false })),
  };
}

export async function markRead(ctx: TenantContext, notificationId: Types.ObjectId) {
  const updated = await Notification.updateOne(
    { ...visibleTo(ctx), _id: notificationId },
    { $addToSet: { readBy: ctx.userId } },
  );
  if (updated.matchedCount === 0) throw AppError.notFound('Notification');
}

export async function markAllRead(ctx: TenantContext): Promise<number> {
  const result = await Notification.updateMany(
    { ...visibleTo(ctx), readBy: { $ne: ctx.userId } },
    { $addToSet: { readBy: ctx.userId } },
  );
  return result.modifiedCount;
}
