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
import * as service from './payments.service';

const allocationSchema = z.object({ invoiceId: objectIdSchema, amountPaise: paiseSchema });

const recordPaymentSchema = z.object({
  branchId: objectIdSchema,
  customerId: objectIdSchema.optional(),
  customerName: z.string().trim().max(160).optional(),
  amountPaise: paiseSchema.refine((v) => v > 0, 'Amount must be more than zero'),
  method: z.enum(Object.values(PAYMENT_METHODS) as [string, ...string[]]),
  reference: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
  allocations: z.array(allocationSchema).min(1, 'Allocate the payment to at least one invoice').max(200),
});

const listQuerySchema = paginationQuerySchema.extend({
  customerId: objectIdSchema.optional(),
  branchId: objectIdSchema.optional(),
  status: z.enum(Object.values(PAYMENT_STATUSES) as [string, ...string[]]).optional(),
  method: z.enum(Object.values(PAYMENT_METHODS) as [string, ...string[]]).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

paymentsRouter.get(
  '/',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW),
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof listQuerySchema>>(req);
    const result = await service.listPayments(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

paymentsRouter.get(
  '/outstanding-invoices',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW),
  validate({ query: z.object({ customerId: objectIdSchema.optional() }) }),
  async (req: Request, res: Response) => {
    const { customerId } = query<{ customerId?: string }>(req);
    const invoices = await service.listOutstandingInvoices(requireContext(req), customerId);
    sendSuccess(res, invoices);
  },
);

paymentsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const payment = await service.getPayment(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'payment id'),
    );
    sendSuccess(res, payment);
  },
);

paymentsRouter.post(
  '/',
  requirePermission(PERMISSIONS.PAYMENTS_CREATE),
  validate({ body: recordPaymentSchema }),
  async (req: Request, res: Response) => {
    const payment = await service.recordPayment(requireContext(req), body(req));
    sendCreated(res, payment, 'Payment recorded');
  },
);

paymentsRouter.post(
  '/:id/void',
  requirePermission(PERMISSIONS.PAYMENTS_VOID),
  validate({ params: idParamSchema, body: z.object({ reason: z.string().trim().max(240).optional() }) }),
  async (req: Request, res: Response) => {
    const { reason } = body<{ reason?: string }>(req);
    const payment = await service.voidPayment(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'payment id'),
      reason,
    );
    sendSuccess(res, payment, 'Payment voided');
  },
);
