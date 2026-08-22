import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS, PERMISSIONS, objectIdSchema, paginationQuerySchema, paiseSchema } from '@shopos/shared';
import { validate, body, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import * as service from './payments.service';

const allocationSchema = z.object({ invoiceId: objectIdSchema, amountPaise: paiseSchema });

const recordPaymentSchema = z.object({
  branchId: objectIdSchema,
  customerId: objectIdSchema.optional(),
  customerName: z.string().trim().max(160).optional(),
  amountPaise: paiseSchema.refine((v) => v > 0, 'Amount must be more than zero'),
  method: z.enum(Object.values(PAYMENT_METHODS) as [string, ...string[]]),
  notes: z.string().trim().max(1000).optional(),
  allocations: z.array(allocationSchema).min(1, 'Allocate the payment to at least one invoice'),
});

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

paymentsRouter.get(
  '/',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW),
  validate({ query: paginationQuerySchema.extend({ customerId: objectIdSchema.optional() }) }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof paginationQuerySchema> & { customerId?: string }>(req);
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

paymentsRouter.post(
  '/',
  requirePermission(PERMISSIONS.PAYMENTS_CREATE),
  validate({ body: recordPaymentSchema }),
  async (req: Request, res: Response) => {
    const payment = await service.recordPayment(requireContext(req), body(req));
    sendCreated(res, payment, 'Payment recorded');
  },
);
