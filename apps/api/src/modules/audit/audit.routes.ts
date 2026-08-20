import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectIdSchema, paginationQuerySchema, toSkip } from '@shopos/shared';
import { AuditLog } from '../../db/models';
import { validate, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendPaginated } from '../../core/http';
import { orgFilter } from '../../core/tenantContext';

/**
 * Reading the audit trail.
 *
 * There is no create, update or delete route here, and there never will be.
 * Append-only is a property of the API surface, not merely of good intentions -
 * entries are written by services and can only be read back.
 */

const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: objectIdSchema.optional(),
  userId: objectIdSchema.optional(),
});

export const auditRouter = Router();

auditRouter.use(authenticate);

auditRouter.get(
  '/',
  requirePermission(PERMISSIONS.AUDIT_LOGS_VIEW),
  validate({ query: auditQuerySchema }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const listQuery = query<z.infer<typeof auditQuerySchema>>(req);

    const filter: Record<string, unknown> = { ...orgFilter(ctx) };
    if (listQuery.action) filter.action = listQuery.action;
    if (listQuery.entityType) filter.entityType = listQuery.entityType;
    if (listQuery.entityId) filter.entityId = listQuery.entityId;
    if (listQuery.userId) filter.userId = listQuery.userId;

    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(toSkip(listQuery.page, listQuery.limit))
        .limit(listQuery.limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    sendPaginated(res, items, { page: listQuery.page, limit: listQuery.limit, total });
  },
);
