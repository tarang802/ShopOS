import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectIdSchema, paginationQuerySchema } from '@shopos/shared';
import { Customer } from '../../db/models';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { paginate, safeSearchRegex } from '../../core/listQuery';
import { AppError } from '../../core/AppError';
import { orgFilter, toObjectId } from '../../core/tenantContext';

/**
 * Customers.
 *
 * Customers are business records, never system users - nothing here creates a
 * login. `defaultPriceListId` exists so that starting an invoice for a regular
 * buyer defaults to the rate they actually get, without a counter staff member
 * needing to remember it.
 */

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(160),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  gstin: z.string().trim().max(20).optional(),
  addressLine: z.string().trim().max(240).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(10).optional(),
  defaultPriceListId: objectIdSchema.optional(),
  isActive: z.boolean().optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });

export const customersRouter = Router();

customersRouter.use(authenticate);

customersRouter.get(
  '/',
  requirePermission(PERMISSIONS.CUSTOMERS_VIEW),
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
      model: Customer,
      filter,
      query: listQuery,
      sortableFields: ['name', 'createdAt'],
      defaultSort: { name: 1 },
    });

    sendPaginated(res, result.items, result);
  },
);

customersRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.CUSTOMERS_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const customer = await Customer.findOne({
      ...orgFilter(ctx),
      _id: toObjectId(params<{ id: string }>(req).id, 'customer id'),
    }).lean();
    if (!customer) throw AppError.notFound('Customer');
    sendSuccess(res, customer);
  },
);

customersRouter.post(
  '/',
  requirePermission(PERMISSIONS.CUSTOMERS_MANAGE),
  validate({ body: customerSchema }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const input = body<z.infer<typeof customerSchema>>(req);
    const { email, ...rest } = input;

    const [customer] = await Customer.create([
      { ...orgFilter(ctx), ...rest, ...(email ? { email } : {}) },
    ]);
    if (!customer) throw AppError.internal('Could not create the customer');

    sendCreated(res, customer.toObject(), 'Customer added');
  },
);

customersRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.CUSTOMERS_MANAGE),
  validate({ params: idParamSchema, body: customerSchema.partial() }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const customer = await Customer.findOne({
      ...orgFilter(ctx),
      _id: toObjectId(params<{ id: string }>(req).id, 'customer id'),
    });
    if (!customer) throw AppError.notFound('Customer');

    Object.assign(customer, body<Partial<z.infer<typeof customerSchema>>>(req));
    await customer.save();

    sendSuccess(res, customer.toObject(), 'Customer updated');
  },
);
