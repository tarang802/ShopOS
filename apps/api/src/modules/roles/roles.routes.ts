import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ALL_PERMISSIONS,
  AUDIT_ACTIONS,
  PERMISSIONS,
  SYSTEM_ROLES,
  isPermission,
  objectIdSchema,
} from '@shopos/shared';
import { Membership, Role } from '../../db/models';
import { validate, body, params } from '../../middleware/validate';
import { authenticate, invalidateAllMemberships, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendSuccess } from '../../core/http';
import { AppError } from '../../core/AppError';
import { orgFilter, toObjectId } from '../../core/tenantContext';
import { diffFields, recordAudit } from '../../services/auditService';

/**
 * Roles: named bundles of permissions, editable per business.
 *
 * The OWNER role is protected from edits and deletion. Everything else can be
 * reshaped freely. Without that guard a business could remove its own ability to
 * manage users and be permanently locked out of its account with no way back
 * except a database repair.
 */

const roleBodySchema = z.object({
  name: z.string().trim().min(2, 'Enter a role name').max(60),
  description: z.string().trim().max(240).optional(),
  permissions: z
    .array(z.string())
    .min(1, 'Select at least one permission')
    .refine((values) => values.every(isPermission), 'Contains an unknown permission'),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const rolesRouter = Router();

rolesRouter.use(authenticate);

/** The full permission catalogue, so the UI can render the grid of checkboxes. */
rolesRouter.get('/permissions', (_req: Request, res: Response) => {
  sendSuccess(res, ALL_PERMISSIONS);
});

rolesRouter.get(
  '/',
  requirePermission(PERMISSIONS.USERS_VIEW),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const roles = await Role.find(orgFilter(ctx)).sort({ isSystem: -1, name: 1 }).lean();

    // How many people hold each role, so the UI can warn before a role is
    // deleted and can explain why deletion is blocked.
    const counts = await Membership.aggregate<{ _id: unknown; count: number }>([
      { $match: orgFilter(ctx) },
      { $group: { _id: '$roleId', count: { $sum: 1 } } },
    ]);
    const countByRole = new Map(counts.map((row) => [String(row._id), row.count]));

    sendSuccess(
      res,
      roles.map((role) => ({ ...role, memberCount: countByRole.get(String(role._id)) ?? 0 })),
    );
  },
);

rolesRouter.post(
  '/',
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  validate({ body: roleBodySchema }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const input = body<z.infer<typeof roleBodySchema>>(req);

    const existing = await Role.findOne({ ...orgFilter(ctx), name: input.name }).lean();
    if (existing) throw AppError.duplicate(`A role named ${input.name} already exists`);

    const [role] = await Role.create([{ ...orgFilter(ctx), ...input, isSystem: false }]);
    if (!role) throw AppError.internal('Could not create the role');

    await recordAudit(ctx, {
      action: AUDIT_ACTIONS.ROLE_CREATED,
      entityType: 'Role',
      entityId: role._id,
      entityLabel: role.name,
      after: { name: role.name, permissions: role.permissions },
    });

    sendCreated(res, role.toObject(), 'Role created');
  },
);

rolesRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  validate({ params: idParamSchema, body: roleBodySchema.partial() }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const roleId = toObjectId(params<{ id: string }>(req).id, 'role id');
    const input = body<Partial<z.infer<typeof roleBodySchema>>>(req);

    const role = await Role.findOne({ ...orgFilter(ctx), _id: roleId });
    if (!role) throw AppError.notFound('Role');

    if (role.code === SYSTEM_ROLES.OWNER) {
      throw AppError.businessRule(
        'The Owner role cannot be changed. It always holds every permission',
      );
    }

    const before = role.toObject();
    Object.assign(role, input);
    await role.save();

    // Many people may hold this role, so every cached permission set is dropped
    // rather than trying to work out which memberships were affected.
    invalidateAllMemberships();

    const changes = diffFields(before, input as Record<string, unknown>);
    if (changes) {
      await recordAudit(ctx, {
        action: AUDIT_ACTIONS.ROLE_CHANGED,
        entityType: 'Role',
        entityId: role._id,
        entityLabel: role.name,
        ...changes,
      });
    }

    sendSuccess(res, role.toObject(), 'Role updated');
  },
);

rolesRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const roleId = toObjectId(params<{ id: string }>(req).id, 'role id');

    const role = await Role.findOne({ ...orgFilter(ctx), _id: roleId });
    if (!role) throw AppError.notFound('Role');
    if (role.isSystem) throw AppError.businessRule('Built-in roles cannot be deleted');

    // A membership pointing at a missing role would leave that person unable to
    // sign in, so the role must be vacated first.
    const inUse = await Membership.countDocuments({ ...orgFilter(ctx), roleId });
    if (inUse > 0) {
      throw AppError.businessRule(
        `${inUse} staff member${inUse === 1 ? '' : 's'} still hold this role. Move them to another role first`,
      );
    }

    await Role.deleteOne({ ...orgFilter(ctx), _id: roleId });

    await recordAudit(ctx, {
      action: AUDIT_ACTIONS.ROLE_DELETED,
      entityType: 'Role',
      entityId: roleId,
      entityLabel: role.name,
      before: { name: role.name, permissions: role.permissions },
    });

    sendSuccess(res, { deleted: true }, 'Role deleted');
  },
);
