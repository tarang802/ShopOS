import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PERMISSIONS,
  objectIdSchema,
  paginationQuerySchema,
  paiseSchema,
} from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import * as service from './supplierPayments.service';

const paymentSchema = z.object({
  branchId: objectIdSchema,
  supplierId: objectIdSchema,
  amountPaise: paiseSchema.refine((value) => value > 0, 'Amount must be more than zero'),
  method: z.enum(Object.values(PAYMENT_METHODS) as [string, ...string[]]),
  reference: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
  allocations: z
    .array(z.object({ purchaseOrderId: objectIdSchema, amountPaise: paiseSchema }))
    .min(1, 'Apply the payment to at least one purchase order')
    .max(200),
});

const listQuerySchema = paginationQuerySchema.extend({
  supplierId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  status: z.enum(Object.values(PAYMENT_STATUSES) as [string, ...string[]]).optional(),
  q: z.string().trim().max(100).optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const supplierPaymentsRouter = Router();
supplierPaymentsRouter.use(authenticate);

supplierPaymentsRouter.get(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_VIEW),
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof listQuerySchema>>(req);
    const result = await service.listSupplierPayments(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

supplierPaymentsRouter.get(
  '/payable-orders',
  requirePermission(PERMISSIONS.PURCHASES_VIEW),
  validate({ query: z.object({ supplierId: objectIdSchema.optional() }) }),
  async (req: Request, res: Response) => {
    const { supplierId } = query<{ supplierId?: string }>(req);
    sendSuccess(res, await service.listPayableOrders(requireContext(req), supplierId));
  },
);

supplierPaymentsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.PURCHASES_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await service.getSupplierPayment(
        requireContext(req),
        toObjectId(params<{ id: string }>(req).id, 'payment id'),
      ),
    );
  },
);

supplierPaymentsRouter.post(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_PAY),
  validate({ body: paymentSchema }),
  async (req: Request, res: Response) => {
    sendCreated(res, await service.recordSupplierPayment(requireContext(req), body(req)), 'Payment recorded');
  },
);

supplierPaymentsRouter.post(
  '/:id/void',
  requirePermission(PERMISSIONS.PURCHASES_PAY),
  validate({ params: idParamSchema, body: z.object({ reason: z.string().trim().max(240).optional() }) }),
  async (req: Request, res: Response) => {
    const { reason } = body<{ reason?: string }>(req);
    const payment = await service.voidSupplierPayment(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'payment id'),
      reason,
    );
    sendSuccess(res, payment, 'Payment voided');
  },
);
