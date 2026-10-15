import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  INVOICE_STATUSES,
  PERMISSIONS,
  objectIdSchema,
  paginationQuerySchema,
  paiseSchema,
  percentSchema,
  positiveQuantitySchema,
} from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import * as service from './invoices.service';

const lineSchema = z.object({
  productId: objectIdSchema,
  quantity: positiveQuantitySchema,
  priceListId: objectIdSchema.optional(),
  discountPercent: percentSchema.optional(),
  overrideUnitPricePaise: paiseSchema.optional(),
});

const createInvoiceSchema = z.object({
  branchId: objectIdSchema,
  customerId: objectIdSchema.optional(),
  customerName: z.string().trim().max(160).optional(),
  creditDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(lineSchema).min(1, 'Add at least one product').max(500),
});

const cancelSchema = z.object({ reason: z.string().trim().max(240).optional() });

const listQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  status: z.enum(Object.values(INVOICE_STATUSES) as [string, ...string[]]).optional(),
  customerId: objectIdSchema.optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // A query string carries booleans as text, and z.coerce.boolean() would turn
  // the string "false" into true.
  overdue: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  outstandingOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const invoicesRouter = Router();

invoicesRouter.use(authenticate);

invoicesRouter.get(
  '/',
  requirePermission(PERMISSIONS.SALES_VIEW),
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof listQuerySchema>>(req);
    const result = await service.listInvoices(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

invoicesRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.SALES_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const invoice = await service.getInvoice(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'invoice id'),
    );
    sendSuccess(res, invoice);
  },
);

invoicesRouter.post(
  '/',
  requirePermission(PERMISSIONS.SALES_CREATE),
  validate({ body: createInvoiceSchema }),
  async (req: Request, res: Response) => {
    const invoice = await service.createInvoice(requireContext(req), body(req));
    sendCreated(res, invoice, 'Invoice created');
  },
);

invoicesRouter.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.SALES_CANCEL),
  validate({ params: idParamSchema, body: cancelSchema }),
  async (req: Request, res: Response) => {
    const { reason } = body<z.infer<typeof cancelSchema>>(req);
    const invoice = await service.cancelInvoice(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'invoice id'),
      reason,
    );
    sendSuccess(res, invoice, 'Invoice cancelled, stock returned');
  },
);
