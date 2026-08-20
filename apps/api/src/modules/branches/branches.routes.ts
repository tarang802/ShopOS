import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectIdSchema, paginationQuerySchema } from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import * as service from './branches.service';

const branchBodySchema = z.object({
  name: z.string().trim().min(1, 'Enter a branch name').max(120),
  code: z
    .string()
    .trim()
    .min(1, 'Enter a short code')
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and dashes only'),
  phone: z.string().trim().max(20).optional(),
  addressLine: z.string().trim().max(240).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(10).optional(),
});

const branchUpdateSchema = branchBodySchema.partial().extend({
  isActive: z.boolean().optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const branchesRouter = Router();

branchesRouter.use(authenticate);

branchesRouter.get(
  '/',
  requirePermission(PERMISSIONS.BRANCHES_VIEW),
  validate({ query: paginationQuerySchema }),
  async (req: Request, res: Response) => {
    const result = await service.listBranches(requireContext(req), query(req));
    sendPaginated(res, result.items, result);
  },
);

branchesRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.BRANCHES_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const branch = await service.getBranch(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'branch id'),
    );
    sendSuccess(res, branch);
  },
);

branchesRouter.post(
  '/',
  requirePermission(PERMISSIONS.BRANCHES_MANAGE),
  validate({ body: branchBodySchema }),
  async (req: Request, res: Response) => {
    const branch = await service.createBranch(requireContext(req), body(req));
    sendCreated(res, branch, 'Branch added');
  },
);

branchesRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.BRANCHES_MANAGE),
  validate({ params: idParamSchema, body: branchUpdateSchema }),
  async (req: Request, res: Response) => {
    const branch = await service.updateBranch(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'branch id'),
      body(req),
    );
    sendSuccess(res, branch, 'Branch updated');
  },
);
