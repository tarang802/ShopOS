import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AUDIT_ACTIONS,
  PERMISSIONS,
  objectIdSchema,
  paginationQuerySchema,
  paiseSchema,
} from '@shopos/shared';
import { Customer, PriceList } from '../../db/models';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { paginate, safeSearchRegex } from '../../core/listQuery';
import { AppError } from '../../core/AppError';
import { orgFilter, toObjectId, type TenantContext } from '../../core/tenantContext';
import { diffFields, recordAudit } from '../../services/auditService';
import { booleanQuery, dateRangeQuery } from '../sales/sales.schemas';
import * as ledger from './customerLedger.service';

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
  creditDays: z.number().int().min(0).max(365).optional(),
  creditLimitPaise: paiseSchema.optional(),
  isActive: z.boolean().optional(),
});

const idParamSchema = z.object({ id: objectIdSchema });

/** A client-supplied rate list id must belong to this business. */
async function assertPriceListOwned(ctx: TenantContext, priceListId?: string): Promise<void> {
  if (!priceListId) return;
  const exists = await PriceList.exists({ ...orgFilter(ctx), _id: priceListId });
  if (!exists) throw AppError.badRequest('Select a valid rate list');
}

export const customersRouter = Router();

customersRouter.use(authenticate);

const listQuerySchema = paginationQuerySchema.extend({
  /** Add what each customer owes to every row. */
  withBalance: booleanQuery,
});

const statementQuerySchema = z.object({ ...dateRangeQuery });

customersRouter.get(
  '/',
  requirePermission(PERMISSIONS.CUSTOMERS_VIEW),
  validate({ query: listQuerySchema }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const listQuery = query<z.infer<typeof listQuerySchema>>(req);

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

    if (listQuery.withBalance && ctx.permissions.has(PERMISSIONS.PAYMENTS_VIEW)) {
      const owed = await ledger.outstandingByCustomer(
        ctx,
        result.items.map((customer) => customer._id),
      );
      const withBalance = result.items.map((customer) => ({
        ...customer,
        outstandingPaise: owed.get(customer._id.toString()) ?? 0,
      }));
      sendPaginated(res, withBalance, result);
      return;
    }

    sendPaginated(res, result.items, result);
  },
);

customersRouter.get(
  '/:id/summary',
  requirePermission(PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.SALES_VIEW),
  validate({ params: idParamSchema }),
  async (req: Request, res: Response) => {
    const summary = await ledger.customerSummary(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'customer id'),
    );
    sendSuccess(res, summary);
  },
);

customersRouter.get(
  '/:id/statement',
  requirePermission(PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.PAYMENTS_VIEW),
  validate({ params: idParamSchema, query: statementQuerySchema }),
  async (req: Request, res: Response) => {
    const range = query<z.infer<typeof statementQuerySchema>>(req);
    const statement = await ledger.customerStatement(
      requireContext(req),
      toObjectId(params<{ id: string }>(req).id, 'customer id'),
      range,
    );
    sendSuccess(res, statement);
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
    await assertPriceListOwned(ctx, rest.defaultPriceListId);

    const [customer] = await Customer.create([
      { ...orgFilter(ctx), ...rest, ...(email ? { email } : {}) },
    ]);
    if (!customer) throw AppError.internal('Could not create the customer');

    await recordAudit(ctx, {
      action: AUDIT_ACTIONS.CUSTOMER_CREATED,
      entityType: 'Customer',
      entityId: customer._id,
      entityLabel: customer.name,
    });

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

    const changes = body<Partial<z.infer<typeof customerSchema>>>(req);
    await assertPriceListOwned(ctx, changes.defaultPriceListId);

    const before = customer.toObject();
    Object.assign(customer, changes);
    await customer.save();

    const diff = diffFields(before, changes);
    if (diff) {
      await recordAudit(ctx, {
        action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
        entityType: 'Customer',
        entityId: customer._id,
        entityLabel: customer.name,
        ...diff,
      });
    }

    sendSuccess(res, customer.toObject(), 'Customer updated');
  },
);
