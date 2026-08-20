import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ADJUSTMENT_REASONS,
  INVENTORY_TRANSACTION_TYPES,
  PERMISSIONS,
  STOCK_TRANSFER_STATUSES,
  objectIdSchema,
  paginationQuerySchema,
  positiveQuantitySchema,
  quantitySchema,
} from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import * as service from './inventory.service';

const stockQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  lowStockOnly: z.coerce.boolean().default(false),
});

const movementQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  type: z.enum(Object.values(INVENTORY_TRANSACTION_TYPES) as [string, ...string[]]).optional(),
});

const adjustmentSchema = z.object({
  branchId: objectIdSchema,
  reason: z.enum(Object.values(ADJUSTMENT_REASONS) as [string, ...string[]]),
  notes: z.string().trim().max(1000).optional(),
  items: z
    .array(
      z.object({
        productId: objectIdSchema,
        countedQuantity: quantitySchema,
      }),
    )
    .min(1, 'Add at least one product')
    .max(500),
});

const openingStockSchema = z.object({
  branchId: objectIdSchema,
  items: z
    .array(z.object({ productId: objectIdSchema, quantity: quantitySchema }))
    .min(1)
    .max(500),
});

const transferSchema = z.object({
  fromBranchId: objectIdSchema,
  toBranchId: objectIdSchema,
  notes: z.string().trim().max(1000).optional(),
  items: z
    .array(z.object({ productId: objectIdSchema, quantity: positiveQuantitySchema }))
    .min(1, 'Add at least one product')
    .max(500),
});

const receiveSchema = z.object({
  items: z
    .array(
      z.object({ productId: objectIdSchema, receivedQuantity: quantitySchema }),
    )
    .optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const inventoryRouter = Router();

inventoryRouter.use(authenticate);

/* ------------------------------- Stock views ------------------------------ */

inventoryRouter.get(
  '/stock',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: stockQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof stockQuerySchema>>(req);
    const result = await service.listStock(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

inventoryRouter.get(
  '/summary',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: z.object({ branchId: objectIdSchema.optional() }) }),
  async (req: Request, res: Response) => {
    const { branchId } = query<{ branchId?: string }>(req);
    const summary = await service.stockSummary(requireContext(req), branchId);
    sendSuccess(res, summary);
  },
);

inventoryRouter.get(
  '/movements',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  validate({ query: movementQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof movementQuerySchema>>(req);
    const result = await service.listMovements(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

/* ------------------------------ Adjustments ------------------------------- */

inventoryRouter.post(
  '/adjustments',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST),
  validate({ body: adjustmentSchema }),
  async (req: Request, res: Response) => {
    const adjustment = await service.createAdjustment(requireContext(req), body(req));
    sendCreated(res, adjustment, 'Stock adjusted');
  },
);

inventoryRouter.post(
  '/opening-stock',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST),
  validate({ body: openingStockSchema }),
  async (req: Request, res: Response) => {
    const result = await service.setOpeningStock(requireContext(req), body(req));
    sendCreated(res, result, 'Opening stock recorded');
  },
);

/* -------------------------------- Transfers ------------------------------- */

inventoryRouter.get(
  '/transfers',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  validate({
    query: paginationQuerySchema.extend({
      status: z
        .enum(Object.values(STOCK_TRANSFER_STATUSES) as [string, ...string[]])
        .optional(),
      branchId: objectIdSchema.optional(),
    }),
  }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof paginationQuerySchema> & { status?: string; branchId?: string }>(req);
    const result = await service.listTransfers(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

inventoryRouter.get(
  '/transfers/:id',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const transfer = await service.getTransfer(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'transfer id'),
    );
    sendSuccess(res, transfer);
  },
);

inventoryRouter.post(
  '/transfers',
  requirePermission(PERMISSIONS.INVENTORY_TRANSFER),
  validate({ body: transferSchema }),
  async (req: Request, res: Response) => {
    const transfer = await service.createTransfer(requireContext(req), body(req));
    sendCreated(res, transfer, 'Stock sent');
  },
);

inventoryRouter.post(
  '/transfers/:id/receive',
  requirePermission(PERMISSIONS.INVENTORY_TRANSFER),
  validate({ params: idParamSchema, body: receiveSchema }),
  async (req: Request, res: Response) => {
    const transfer = await service.receiveTransfer(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'transfer id'),
      body(req),
    );
    sendSuccess(res, transfer, 'Stock received');
  },
);

inventoryRouter.post(
  '/transfers/:id/cancel',
  requirePermission(PERMISSIONS.INVENTORY_TRANSFER),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const transfer = await service.cancelTransfer(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'transfer id'),
    );
    sendSuccess(res, transfer, 'Transfer cancelled, stock returned');
  },
);
