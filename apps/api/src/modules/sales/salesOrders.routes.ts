import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  SALES_ORDER_STATUSES,
  objectIdSchema,
  paginationQuerySchema,
  positiveQuantitySchema,
} from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import { linesSchema } from './sales.schemas';
import * as service from './salesOrders.service';

const orderSchema = z.object({
  branchId: objectIdSchema,
  customerId: objectIdSchema.optional(),
  customerName: z.string().trim().max(160).optional(),
  expectedDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
  items: linesSchema,
});

const invoiceOrderSchema = z.object({
  items: z
    .array(z.object({ productId: objectIdSchema, quantity: positiveQuantitySchema }))
    .max(500)
    .optional(),
  creditDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const listQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  customerId: objectIdSchema.optional(),
  status: z.enum(Object.values(SALES_ORDER_STATUSES) as [string, ...string[]]).optional(),
  q: z.string().trim().max(100).optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });
const orderId = (req: Request) => toObjectId(params<{ id: string }>(req).id, 'sales order id');

export const salesOrdersRouter = Router();
salesOrdersRouter.use(authenticate);

salesOrdersRouter.get(
  '/',
  requirePermission(PERMISSIONS.SALES_VIEW),
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof listQuerySchema>>(req);
    const result = await service.listSalesOrders(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

salesOrdersRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.SALES_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    sendSuccess(res, await service.getSalesOrder(requireContext(req), orderId(req)));
  },
);

salesOrdersRouter.post(
  '/',
  requirePermission(PERMISSIONS.SALES_CREATE),
  validate({ body: orderSchema }),
  async (req: Request, res: Response) => {
    sendCreated(res, await service.createSalesOrder(requireContext(req), body(req)), 'Sales order created');
  },
);

salesOrdersRouter.put(
  '/:id',
  requirePermission(PERMISSIONS.SALES_UPDATE),
  validate({ params: idParamSchema, body: orderSchema }),
  async (req: Request, res: Response) => {
    sendSuccess(res, await service.updateSalesOrder(requireContext(req), orderId(req), body(req)), 'Sales order updated');
  },
);

salesOrdersRouter.post(
  '/:id/confirm',
  requirePermission(PERMISSIONS.SALES_UPDATE),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    sendSuccess(res, await service.confirmSalesOrder(requireContext(req), orderId(req)), 'Sales order confirmed');
  },
);

salesOrdersRouter.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.SALES_CANCEL),
  validate({ params: idParamSchema, body: z.object({ reason: z.string().trim().max(240).optional() }) }),
  async (req: Request, res: Response) => {
    const { reason } = body<{ reason?: string }>(req);
    sendSuccess(res, await service.cancelSalesOrder(requireContext(req), orderId(req), reason), 'Sales order cancelled');
  },
);

salesOrdersRouter.post(
  '/:id/invoice',
  requirePermission(PERMISSIONS.SALES_CREATE),
  validate({ params: idParamSchema, body: invoiceOrderSchema }),
  async (req: Request, res: Response) => {
    const result = await service.invoiceSalesOrder(requireContext(req), orderId(req), body(req));
    sendCreated(res, result, 'Invoice created from the sales order');
  },
);
