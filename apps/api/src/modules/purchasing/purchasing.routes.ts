import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  PURCHASE_ORDER_STATUSES,
  objectIdSchema,
  paginationQuerySchema,
  paiseSchema,
  positiveQuantitySchema,
} from '@shopos/shared';
import { Supplier } from '../../db/models';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { paginate, safeSearchRegex } from '../../core/listQuery';
import { AppError } from '../../core/AppError';
import { orgFilter, toObjectId } from '../../core/tenantContext';
import * as service from './purchasing.service';

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(160),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  gstin: z.string().trim().max(20).optional(),
  addressLine: z.string().trim().max(240).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(10).optional(),
  isActive: z.boolean().optional(),
});

export const suppliersRouter = Router();
suppliersRouter.use(authenticate);

suppliersRouter.get(
  '/',
  requirePermission(PERMISSIONS.SUPPLIERS_VIEW),
  validate({ query: paginationQuerySchema }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const listQuery = query<z.infer<typeof paginationQuerySchema>>(req);

    const filter: Record<string, unknown> = { ...orgFilter(ctx), isActive: true };
    if (listQuery.search) {
      const pattern = safeSearchRegex(listQuery.search);
      filter.$or = [{ name: pattern }, { phone: pattern }];
    }

    const result = await paginate({
      model: Supplier,
      filter,
      query: listQuery,
      sortableFields: ['name', 'createdAt'],
      defaultSort: { name: 1 },
    });
    sendPaginated(res, result.items, result);
  },
);

suppliersRouter.post(
  '/',
  requirePermission(PERMISSIONS.SUPPLIERS_MANAGE),
  validate({ body: supplierSchema }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const input = body<z.infer<typeof supplierSchema>>(req);
    const { email, ...rest } = input;
    const [supplier] = await Supplier.create([{ ...orgFilter(ctx), ...rest, ...(email ? { email } : {}) }]);
    if (!supplier) throw AppError.internal('Could not create the supplier');
    sendCreated(res, supplier.toObject(), 'Supplier added');
  },
);

suppliersRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.SUPPLIERS_MANAGE),
  validate({ params: z.object({ id: objectIdSchema }), body: supplierSchema.partial() }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const supplier = await Supplier.findOne({
      ...orgFilter(ctx),
      _id: toObjectId(params<{ id: string }>(req).id, 'supplier id'),
    });
    if (!supplier) throw AppError.notFound('Supplier');
    Object.assign(supplier, body<Partial<z.infer<typeof supplierSchema>>>(req));
    await supplier.save();
    sendSuccess(res, supplier.toObject(), 'Supplier updated');
  },
);

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

const poLineSchema = z.object({
  productId: objectIdSchema,
  orderedQty: positiveQuantitySchema,
  unitPricePaise: paiseSchema,
});

const createPoSchema = z.object({
  branchId: objectIdSchema,
  supplierId: objectIdSchema,
  notes: z.string().trim().max(1000).optional(),
  items: z.array(poLineSchema).min(1, 'Add at least one product').max(500),
});

const receiveSchema = z.object({
  items: z.array(z.object({ productId: objectIdSchema, receivedQty: positiveQuantitySchema })).min(1),
  notes: z.string().trim().max(1000).optional(),
});

const listPoQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  status: z.enum(Object.values(PURCHASE_ORDER_STATUSES) as [string, ...string[]]).optional(),
  supplierId: objectIdSchema.optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(authenticate);

purchaseOrdersRouter.get(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_VIEW),
  validate({ query: listPoQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof listPoQuerySchema>>(req);
    const result = await service.listPurchaseOrders(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

purchaseOrdersRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.PURCHASES_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const po = await service.getPurchaseOrder(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'purchase order id'),
    );
    sendSuccess(res, po);
  },
);

purchaseOrdersRouter.post(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_CREATE),
  validate({ body: createPoSchema }),
  async (req: Request, res: Response) => {
    const po = await service.createPurchaseOrder(requireContext(req), body(req));
    sendCreated(res, po, 'Purchase order created');
  },
);

purchaseOrdersRouter.post(
  '/:id/send',
  requirePermission(PERMISSIONS.PURCHASES_UPDATE),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const po = await service.sendPurchaseOrder(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'purchase order id'),
    );
    sendSuccess(res, po, 'Purchase order sent to supplier');
  },
);

purchaseOrdersRouter.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.PURCHASES_UPDATE),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const po = await service.cancelPurchaseOrder(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'purchase order id'),
    );
    sendSuccess(res, po, 'Purchase order cancelled');
  },
);

purchaseOrdersRouter.post(
  '/:id/receive',
  requirePermission(PERMISSIONS.PURCHASES_RECEIVE),
  validate({ params: idParamSchema, body: receiveSchema }),
  async (req: Request, res: Response) => {
    const result = await service.receiveGoods(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'purchase order id'),
      body(req),
    );
    sendCreated(res, result, 'Goods received');
  },
);
