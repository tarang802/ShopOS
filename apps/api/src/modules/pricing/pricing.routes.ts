import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectIdSchema, paiseSchema } from '@shopos/shared';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendSuccess } from '../../core/http';
import { toObjectId } from '../../core/tenantContext';
import * as service from './pricing.service';

const tierSchema = z.object({
  minQuantity: z.number().int().min(1),
  // null, not undefined: the open-ended top slab is an explicit choice, and
  // leaving the field out entirely would be indistinguishable from forgetting it.
  maxQuantity: z.number().int().min(1).nullable(),
  pricePaise: paiseSchema,
});

const setPriceSchema = z.object({
  priceListId: objectIdSchema,
  tiers: z.array(tierSchema).min(1, 'Add at least one quantity slab').max(20),
});

const priceListSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(60),
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dashes and underscores only'),
  description: z.string().trim().max(240).optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

const resolveQuerySchema = z.object({
  productId: objectIdSchema,
  priceListId: objectIdSchema.optional(),
  quantity: z.coerce.number().positive('Quantity must be more than zero'),
});

export const pricingRouter = Router();

pricingRouter.use(authenticate);

/* -------------------------------------------------------------------------- */
/* Rate lists                                                                  */
/* -------------------------------------------------------------------------- */

pricingRouter.get(
  '/lists',
  requirePermission(PERMISSIONS.PRICING_VIEW),
  validate({ query: z.object({ includeInactive: z.coerce.boolean().default(false) }) }),
  async (req: Request, res: Response) => {
    const { includeInactive } = query<{ includeInactive: boolean }>(req);
    const lists = await service.listPriceLists(requireContext(req), includeInactive);
    sendSuccess(res, lists);
  },
);

pricingRouter.post(
  '/lists',
  requirePermission(PERMISSIONS.PRICING_CREATE),
  validate({ body: priceListSchema }),
  async (req: Request, res: Response) => {
    const list = await service.createPriceList(requireContext(req), body(req));
    sendCreated(res, list, 'Rate list created');
  },
);

pricingRouter.patch(
  '/lists/:id',
  requirePermission(PERMISSIONS.PRICING_UPDATE),
  validate({ params: z.object({ id: objectIdSchema }), body: priceListSchema.partial() }),
  async (req: Request, res: Response) => {
    const list = await service.updatePriceList(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'rate list id'),
      body(req),
    );
    sendSuccess(res, list, 'Rate list updated');
  },
);

/* -------------------------------------------------------------------------- */
/* The pricing engine                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The rate for a quantity. This is what a sales screen calls before it can put a
 * line on a bill, and what the rate calculator on the product page uses.
 */
pricingRouter.get(
  '/resolve',
  requirePermission(PERMISSIONS.PRICING_VIEW),
  validate({ query: resolveQuerySchema }),
  async (req: Request, res: Response) => {
    const input = query<z.infer<typeof resolveQuerySchema>>(req);
    const result = await service.resolvePrice(requireContext(req), {
      productId: toObjectId(input.productId, 'product id'),
      ...(input.priceListId ? { priceListId: toObjectId(input.priceListId, 'rate list id') } : {}),
      quantity: input.quantity,
    });
    sendSuccess(res, result);
  },
);

pricingRouter.get(
  '/recent',
  requirePermission(PERMISSIONS.PRICING_VIEW),
  async (req: Request, res: Response) => {
    const updates = await service.recentPriceUpdates(requireContext(req));
    sendSuccess(res, updates);
  },
);

/* -------------------------------------------------------------------------- */
/* Rate cards on a product                                                     */
/* -------------------------------------------------------------------------- */

pricingRouter.put(
  '/products/:productId',
  requirePermission(PERMISSIONS.PRICING_UPDATE),
  validate({ params: z.object({ productId: objectIdSchema }), body: setPriceSchema }),
  async (req: Request, res: Response) => {
    const input = body<z.infer<typeof setPriceSchema>>(req);
    const price = await service.setProductPrice(
      requireContext(req),
      toObjectId(params<{ productId: string }>(req).productId, 'product id'),
      toObjectId(input.priceListId, 'rate list id'),
      input.tiers,
    );
    sendSuccess(res, price, 'Rates saved');
  },
);

pricingRouter.delete(
  '/products/:productId/:priceListId',
  requirePermission(PERMISSIONS.PRICING_DELETE),
  validate({
    params: z.object({ productId: objectIdSchema, priceListId: objectIdSchema }),
  }),
  async (req: Request, res: Response) => {
    const input = params<{ productId: string; priceListId: string }>(req);
    const result = await service.removeProductPrice(
      requireContext(req),
      toObjectId(input.productId, 'product id'),
      toObjectId(input.priceListId, 'rate list id'),
    );
    sendSuccess(res, result, 'Rate removed');
  },
);
