import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  QUOTATION_STATUSES,
  objectIdSchema,
  paginationQuerySchema,
} from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import { linesSchema, paymentInputSchema } from './sales.schemas';
import * as service from './quotations.service';

const quotationSchema = z.object({
  branchId: objectIdSchema,
  customerId: objectIdSchema.optional(),
  customerName: z.string().trim().max(160).optional(),
  validDays: z.number().int().min(1).max(365).optional(),
  notes: z.string().trim().max(1000).optional(),
  terms: z.string().trim().max(1000).optional(),
  items: linesSchema,
});

const listQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  customerId: objectIdSchema.optional(),
  status: z.enum(Object.values(QUOTATION_STATUSES) as [string, ...string[]]).optional(),
  q: z.string().trim().max(100).optional(),
});

const convertToInvoiceSchema = z.object({
  creditDays: z.number().int().min(0).max(365).optional(),
  payment: paymentInputSchema.optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });
const quotationId = (req: Request) => toObjectId(params<{ id: string }>(req).id, 'quotation id');

export const quotationsRouter = Router();
quotationsRouter.use(authenticate);

quotationsRouter.get(
  '/',
  requirePermission(PERMISSIONS.SALES_VIEW),
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof listQuerySchema>>(req);
    const result = await service.listQuotations(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

quotationsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.SALES_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    sendSuccess(res, await service.getQuotation(requireContext(req), quotationId(req)));
  },
);

quotationsRouter.post(
  '/',
  requirePermission(PERMISSIONS.SALES_CREATE),
  validate({ body: quotationSchema }),
  async (req: Request, res: Response) => {
    sendCreated(res, await service.createQuotation(requireContext(req), body(req)), 'Quotation created');
  },
);

quotationsRouter.put(
  '/:id',
  requirePermission(PERMISSIONS.SALES_UPDATE),
  validate({ params: idParamSchema, body: quotationSchema }),
  async (req: Request, res: Response) => {
    sendSuccess(res, await service.updateQuotation(requireContext(req), quotationId(req), body(req)), 'Quotation updated');
  },
);

for (const action of ['send', 'accept', 'reject'] as const) {
  quotationsRouter.post(
    `/:id/${action}`,
    requirePermission(PERMISSIONS.SALES_UPDATE),
    validate({ params: idParamSchema }),
    async (req: Request, res: Response) => {
      const updated = await service.transitionQuotation(requireContext(req), quotationId(req), action);
      sendSuccess(res, updated, `Quotation ${action === 'send' ? 'sent' : action === 'accept' ? 'accepted' : 'rejected'}`);
    },
  );
}

quotationsRouter.post(
  '/:id/extend',
  requirePermission(PERMISSIONS.SALES_UPDATE),
  validate({ params: idParamSchema, body: z.object({ days: z.number().int().min(1).max(365) }) }),
  async (req: Request, res: Response) => {
    const { days } = body<{ days: number }>(req);
    sendSuccess(res, await service.extendQuotation(requireContext(req), quotationId(req), days), 'Quotation extended');
  },
);

quotationsRouter.post(
  '/:id/convert-to-order',
  requirePermission(PERMISSIONS.SALES_CREATE),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    sendCreated(res, await service.convertToSalesOrder(requireContext(req), quotationId(req)), 'Sales order created from the quotation');
  },
);

quotationsRouter.post(
  '/:id/convert-to-invoice',
  requirePermission(PERMISSIONS.SALES_CREATE),
  validate({ params: idParamSchema, body: convertToInvoiceSchema }),
  async (req: Request, res: Response) => {
    const invoice = await service.convertToInvoice(requireContext(req), quotationId(req), body(req));
    sendCreated(res, invoice, 'Invoice created from the quotation');
  },
);
