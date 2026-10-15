import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  RETURN_REASONS,
  objectIdSchema,
  paginationQuerySchema,
  positiveQuantitySchema,
} from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import * as service from './purchaseReturns.service';

const returnSchema = z.object({
  purchaseOrderId: objectIdSchema,
  reason: z.enum(Object.values(RETURN_REASONS) as [string, ...string[]]),
  notes: z.string().trim().max(1000).optional(),
  items: z
    .array(z.object({ productId: objectIdSchema, quantity: positiveQuantitySchema }))
    .min(1, 'Choose at least one item to send back')
    .max(500)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      for (const [index, item] of items.entries()) {
        if (seen.has(item.productId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'productId'],
            message: 'This product is already in the return',
          });
        }
        seen.add(item.productId);
      }
    }),
});

const listQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  supplierId: objectIdSchema.optional(),
  purchaseOrderId: objectIdSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

export const purchaseReturnsRouter = Router();
purchaseReturnsRouter.use(authenticate);

purchaseReturnsRouter.get(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_VIEW),
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof listQuerySchema>>(req);
    const result = await service.listPurchaseReturns(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

purchaseReturnsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.PURCHASES_VIEW),
  validate({ params: z.object({ id: objectIdSchema }) }),
  async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await service.getPurchaseReturn(
        requireContext(req),
        toObjectId(params<{ id: string }>(req).id, 'return id'),
      ),
    );
  },
);

purchaseReturnsRouter.post(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_RETURN),
  validate({ body: returnSchema }),
  async (req: Request, res: Response) => {
    sendCreated(res, await service.createPurchaseReturn(requireContext(req), body(req)), 'Return recorded');
  },
);
