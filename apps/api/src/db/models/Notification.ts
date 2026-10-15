import { Schema, Types, model } from 'mongoose';
import type { NotificationSeverity, NotificationType, Permission } from '@shopos/shared';
import { ALL_PERMISSIONS, NOTIFICATION_SEVERITIES, NOTIFICATION_TYPES } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * Something a person in the business should know about.
 *
 * A notification belongs to the business, not to one user: the same low-stock
 * alert is shown to everyone who may see stock at that branch. Who counts as
 * "may see" is decided when it is read, from `requiredPermission` and `branchId`,
 * so a demotion or a branch change takes effect without rewriting history.
 *
 * Read state is per person, kept as the list of people who have read it - a
 * business has dozens of staff, not millions, so the list stays small.
 *
 * `dedupeKey` makes creation idempotent. The same overdue invoice found by a sweep
 * every hour must not become twenty-four notifications.
 */

export interface INotification {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  /** An app path the notification opens, e.g. /sales/<id>. */
  link?: string;
  /** Only people holding this permission see it. Blank means everyone. */
  requiredPermission?: Permission;
  /** Only people who work in this branch see it. Blank means every branch. */
  branchId?: Types.ObjectId;
  dedupeKey?: string;
  readBy: Types.ObjectId[];
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true },
    severity: {
      type: String,
      enum: Object.values(NOTIFICATION_SEVERITIES),
      required: true,
      default: NOTIFICATION_SEVERITIES.INFO,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, trim: true, maxlength: 400 },
    link: { type: String, trim: true, maxlength: 200 },
    requiredPermission: { type: String, enum: ALL_PERMISSIONS as unknown as string[] },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
    dedupeKey: { type: String, trim: true, maxlength: 160 },
    readBy: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ organizationId: 1, createdAt: -1 });
// One notification per key. Partial, so notifications without a key are unaffected.
notificationSchema.index(
  { organizationId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
// Old notifications clear themselves; an inbox that only grows stops being read.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

notificationSchema.plugin(tenantGuard);

export const Notification = model<INotification>('Notification', notificationSchema);
