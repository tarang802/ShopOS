import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PAYMENT_METHODS,
  PERMISSIONS,
  RETURN_REASONS,
  objectIdSchema,
  paginationQuerySchema,
  paiseSchema,
  positiveQuantitySchema,
} from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import { dateRangeQuery } from './sales.schemas';
import * as service from './salesReturns.service';

const refundSchema = z.object({
  method: z.enum(Object.values(PAYMENT_METHODS) as [string, ...string[]]),
  amountPaise: paiseSchema.refine((value) => value > 0, 'Amount must be more than zero'),
  reference: z.string().trim().max(60).optional(),
});

const returnSchema = z.object({
  invoiceId: objectIdSchema,
  reason: z.enum(Object.values(RETURN_REASONS) as [string, ...string[]]),
  notes: z.string().trim().max(1000).optional(),
  items: z
    .array(
      z.object({
        productId: objectIdSchema,
        quantity: positiveQuantitySchema,
        restock: z.boolean().optional(),
      }),
    )
    .min(1, 'Choose at least one item to return')
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
  refund: refundSchema.optional(),
});

const listQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  customerId: objectIdSchema.optional(),
  invoiceId: objectIdSchema.optional(),
  q: z.string().trim().max(100).optional(),
  ...dateRangeQuery,
});

const idParamSchema = z.object({ id: objectIdSchema });

export const salesReturnsRouter = Router();
salesReturnsRouter.use(authenticate);

salesReturnsRouter.get(
  '/',
  requirePermission(PERMISSIONS.SALES_VIEW),
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof listQuerySchema>>(req);
    const result = await service.listSalesReturns(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

salesReturnsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.SALES_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await service.getSalesReturn(requireContext(req), toObjectId(params<{ id: string }>(req).id, 'return id')),
    );
  },
);

salesReturnsRouter.post(
  '/',
  requirePermission(PERMISSIONS.SALES_RETURN),
  validate({ body: returnSchema }),
  async (req: Request, res: Response) => {
    sendCreated(res, await service.createSalesReturn(requireContext(req), body(req)), 'Return recorded');
  },
);

salesReturnsRouter.post(
  '/:id/refund',
  requirePermission(PERMISSIONS.SALES_RETURN),
  validate({ params: idParamSchema, body: refundSchema }),
  async (req: Request, res: Response) => {
    const updated = await service.refundSalesReturn(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'return id'),
      body(req),
    );
    sendSuccess(res, updated, 'Refund recorded');
  },
);
