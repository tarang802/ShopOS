import { Schema, Types, model } from 'mongoose';
import type { AuditAction } from '@shopos/shared';
import { tenantGuard } from '../plugins/tenantGuard';

/**
 * Who changed what, when, and what it was before.
 *
 * The first question an owner asks when a rate looks wrong is not "what is the
 * rate?" - it is "who changed it, and what was it before?". This collection is
 * the only place that can answer that, so it is written on every meaningful
 * change and is never updated or deleted afterwards.
 *
 * `before` and `after` hold only the fields that actually changed, not the whole
 * document. Storing full snapshots would multiply the size of the busiest
 * collection in the system for no extra insight.
 *
 * There is no update or delete path anywhere in the codebase for this model.
 * Append-only is a property of the API surface, not just of good intentions.
 */

export interface IAuditLog {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;

  action: AuditAction;
  /** Product, ProductPrice, Branch, Membership, and so on. */
  entityType: string;
  entityId?: Types.ObjectId;
  /** Readable name at the time, so the log stays legible if the entity is renamed. */
  entityLabel?: string;

  userId: Types.ObjectId;
  userName: string;

  /** Changed fields only. Absent for pure creations and deletions. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;

  branchId?: Types.ObjectId;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    action: { type: String, required: true, maxlength: 60 },
    entityType: { type: String, required: true, maxlength: 40 },
    entityId: { type: Schema.Types.ObjectId },
    entityLabel: { type: String, maxlength: 240 },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true, maxlength: 120 },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
    ipAddress: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 400 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The audit screen: newest first, for this business.
auditLogSchema.index({ organizationId: 1, createdAt: -1 });
// "History of this one product" - shown on the product detail page.
auditLogSchema.index({ organizationId: 1, entityType: 1, entityId: 1, createdAt: -1 });
// "What has this staff member been doing?"
auditLogSchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, action: 1, createdAt: -1 });

auditLogSchema.plugin(tenantGuard);

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
