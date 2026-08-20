import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  MEMBERSHIP_STATUSES,
  PERMISSIONS,
  emailSchema,
  objectIdSchema,
  paginationQuerySchema,
  passwordSchema,
} from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import * as service from './users.service';

const createMemberSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().trim().max(20).optional(),
  roleId: objectIdSchema,
  allBranches: z.boolean().default(false),
  branchIds: z.array(objectIdSchema).default([]),
});

const updateMemberSchema = z.object({
  roleId: objectIdSchema.optional(),
  allBranches: z.boolean().optional(),
  branchIds: z.array(objectIdSchema).optional(),
  status: z.enum([
    MEMBERSHIP_STATUSES.ACTIVE,
    MEMBERSHIP_STATUSES.SUSPENDED,
    MEMBERSHIP_STATUSES.INVITED,
  ]).optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get(
  '/',
  requirePermission(PERMISSIONS.USERS_VIEW),
  validate({ query: paginationQuerySchema }),
  async (req: Request, res: Response) => {
    const result = await service.listMembers(requireContext(req), query(req));
    sendPaginated(res, result.items, result);
  },
);

usersRouter.post(
  '/',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate({ body: createMemberSchema }),
  async (req: Request, res: Response) => {
    const member = await service.createMember(requireContext(req), body(req));
    sendCreated(res, member, 'Staff member added');
  },
);

usersRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  validate({ params: idParamSchema, body: updateMemberSchema }),
  async (req: Request, res: Response) => {
    const membership = await service.updateMember(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'staff id'),
      body(req),
    );
    sendSuccess(res, membership, 'Staff member updated');
  },
);
