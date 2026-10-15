import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectIdSchema, paginationQuerySchema, paiseSchema } from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import { buildUploadSignature } from '../../config/cloudinary';
import * as service from './products.service';

const barcodeSchema = z.object({
  code: z.string().trim().min(1).max(60),
  type: z.string().trim().max(20).optional(),
});

const imageSchema = z.object({
  url: z.string().url().max(600),
  publicId: z.string().trim().min(1).max(240),
  isPrimary: z.boolean().optional(),
});

const productCreateSchema = z.object({
  name: z.string().trim().min(1, 'Enter a product name').max(200),
  sku: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(),
  brandId: objectIdSchema.optional(),
  categoryId: objectIdSchema.optional(),
  unitId: objectIdSchema,
  barcodes: z.array(barcodeSchema).max(20).optional(),
  images: z.array(imageSchema).max(8).optional(),
  taxRatePercent: z.number().min(0).max(100).optional(),
  reorderLevel: z.number().min(0).max(1_000_000).optional(),
  costPricePaise: paiseSchema.optional(),
});

const productListQuerySchema = paginationQuerySchema.extend({
  categoryId: objectIdSchema.optional(),
  brandId: objectIdSchema.optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const productsRouter = Router();

productsRouter.use(authenticate);

productsRouter.get(
  '/',
  requirePermission(PERMISSIONS.PRODUCTS_VIEW),
  validate({ query: productListQuerySchema }),
  async (req: Request, res: Response) => {
    const listQuery = query<z.infer<typeof productListQuerySchema>>(req);
    const result = await service.listProducts(requireContext(req), listQuery, listQuery);
    sendPaginated(res, result.items, result);
  },
);

/**
 * Signed parameters for a direct browser-to-Cloudinary upload.
 *
 * WHY the image never passes through this API: proxying binaries would tie up a
 * Node process for the length of every upload, on a connection that in an Indian
 * shop may be a phone hotspot. The browser uploads straight to Cloudinary using
 * a signature this endpoint produces, then sends back only the resulting URL.
 * The API secret stays on the server throughout.
 */
productsRouter.get(
  '/upload-signature',
  requirePermission(PERMISSIONS.PRODUCTS_CREATE),
  (req: Request, res: Response) => {
    const ctx = requireContext(req);
    sendSuccess(res, buildUploadSignature(ctx.organizationId.toString()));
  },
);

productsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.PRODUCTS_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const detail = await service.getProductDetail(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'product id'),
    );
    sendSuccess(res, detail);
  },
);

productsRouter.post(
  '/',
  requirePermission(PERMISSIONS.PRODUCTS_CREATE),
  validate({ body: productCreateSchema }),
  async (req: Request, res: Response) => {
    const product = await service.createProduct(requireContext(req), body(req));
    sendCreated(res, product, 'Product added');
  },
);

productsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.PRODUCTS_UPDATE),
  validate({ params: idParamSchema, body: productCreateSchema.partial() }),
  async (req: Request, res: Response) => {
    const product = await service.updateProduct(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'product id'),
      body(req),
    );
    sendSuccess(res, product, 'Product updated');
  },
);

productsRouter.post(
  '/:id/archive',
  requirePermission(PERMISSIONS.PRODUCTS_ARCHIVE),
  validate({ params: idParamSchema, body: z.object({ isActive: z.boolean() }) }),
  async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const product = await service.setProductActive(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'product id'),
      isActive,
    );
    sendSuccess(res, product, isActive ? 'Product restored' : 'Product archived');
  },
);
