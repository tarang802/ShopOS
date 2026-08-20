import { Router, type Request, type Response } from 'express';
import type { Model, Types } from 'mongoose';
import { z, type ZodTypeAny } from 'zod';
import {
  AUDIT_ACTIONS,
  PERMISSIONS,
  objectIdSchema,
  paginationQuerySchema,
  type AuditAction,
} from '@shopos/shared';
import { Brand, Category, Product, Unit } from '../../db/models';
import { validate, body, params, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendCreated, sendPaginated, sendSuccess } from '../../core/http';
import { paginate, safeSearchRegex } from '../../core/listQuery';
import { AppError } from '../../core/AppError';
import { orgFilter, toObjectId } from '../../core/tenantContext';
import { diffFields, recordAudit } from '../../services/auditService';

/**
 * Categories, brands and units share one implementation.
 *
 * All three are the same shape of thing: a small, name-keyed list owned by the
 * business, referenced by products, never deleted once used. Writing the same
 * CRUD three times would mean three places to fix a bug in the rename-cascade or
 * the in-use check, so it is written once and configured three ways.
 */

/**
 * The shape all three lists share. Declaring it explicitly - rather than making
 * the helper generic over each model - keeps the shared CRUD readable and lets
 * TypeScript check the parts that actually matter here: the name and the id.
 */
interface MasterDocument {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
}

interface MasterConfig {
  model: Model<MasterDocument>;
  label: string;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  createdAction: AuditAction;
  updatedAction: AuditAction;
  /** Permission needed to change the list. Reading only needs products:view. */
  managePermission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
  searchFields: string[];
  sortableFields: string[];
  /**
   * Products carry a copy of this record's name for fast search results, so a
   * rename must update those copies too.
   */
  denormalizedField?: 'brandName' | 'categoryName';
  productForeignKey?: 'brandId' | 'categoryId' | 'unitId';
}

const idParamSchema = z.object({ id: objectIdSchema });

function buildMasterRouter(config: MasterConfig): Router {
  const router = Router();

  router.get(
    '/',
    requirePermission(PERMISSIONS.PRODUCTS_VIEW),
    validate({ query: paginationQuerySchema }),
    async (req: Request, res: Response) => {
      const ctx = requireContext(req);
      const listQuery = query<z.infer<typeof paginationQuerySchema>>(req);

      const filter: Record<string, unknown> = { ...orgFilter(ctx) };
      if (listQuery.search) {
        const pattern = safeSearchRegex(listQuery.search);
        filter.$or = config.searchFields.map((field) => ({ [field]: pattern }));
      }

      const result = await paginate({
        model: config.model,
        filter,
        query: listQuery,
        sortableFields: config.sortableFields,
        defaultSort: { name: 1 },
      });

      sendPaginated(res, result.items, result);
    },
  );

  router.post(
    '/',
    requirePermission(config.managePermission),
    validate({ body: config.createSchema }),
    async (req: Request, res: Response) => {
      const ctx = requireContext(req);
      const input = body<Record<string, unknown>>(req);

      const name = String(input.name).trim();
      const existing = await config.model.findOne({ ...orgFilter(ctx), name }).lean();
      if (existing) throw AppError.duplicate(`${config.label} "${name}" already exists`);

      const [created] = await config.model.create([{ ...orgFilter(ctx), ...input }]);
      if (!created) throw AppError.internal(`Could not create the ${config.label.toLowerCase()}`);

      await recordAudit(ctx, {
        action: config.createdAction,
        entityType: config.label,
        entityId: created._id,
        entityLabel: created.name,
        after: input,
      });

      sendCreated(res, created.toObject(), `${config.label} added`);
    },
  );

  router.patch(
    '/:id',
    requirePermission(config.managePermission),
    validate({ params: idParamSchema, body: config.updateSchema }),
    async (req: Request, res: Response) => {
      const ctx = requireContext(req);
      const id = toObjectId(params<{ id: string }>(req).id, 'id');
      const input = body<Record<string, unknown>>(req);

      const record = await config.model.findOne({ ...orgFilter(ctx), _id: id });
      if (!record) throw AppError.notFound(config.label);

      if (typeof input.name === 'string' && input.name.trim() !== record.name) {
        const clash = await config.model
          .findOne({ ...orgFilter(ctx), name: input.name.trim() })
          .lean();
        if (clash) throw AppError.duplicate(`${config.label} "${input.name}" already exists`);
      }

      const before = record.toObject();
      Object.assign(record, input);
      await record.save();

      // Keep the copies on products in step with the rename. Products carry
      // brandName and categoryName so a search result needs no extra lookups;
      // that speed is only worth having if the copies stay correct.
      if (config.denormalizedField && config.productForeignKey && input.name) {
        await Product.updateMany(
          { ...orgFilter(ctx), [config.productForeignKey]: id },
          { $set: { [config.denormalizedField]: record.name } },
        );
      }

      const changes = diffFields(before, input);
      if (changes) {
        await recordAudit(ctx, {
          action: config.updatedAction,
          entityType: config.label,
          entityId: record._id,
          entityLabel: record.name,
          ...changes,
        });
      }

      sendSuccess(res, record.toObject(), `${config.label} updated`);
    },
  );

  router.delete(
    '/:id',
    requirePermission(config.managePermission),
    validate({ params: idParamSchema }),
    async (req: Request, res: Response) => {
      const ctx = requireContext(req);
      const id = toObjectId(params<{ id: string }>(req).id, 'id');

      const record = await config.model.findOne({ ...orgFilter(ctx), _id: id });
      if (!record) throw AppError.notFound(config.label);

      // Deleting something products point at would leave those products with a
      // dangling reference, so the list must be vacated first. This is a hard
      // delete precisely because nothing references it.
      if (config.productForeignKey) {
        const inUse = await Product.countDocuments({
          ...orgFilter(ctx),
          [config.productForeignKey]: id,
        });
        if (inUse > 0) {
          throw AppError.businessRule(
            `${inUse} product${inUse === 1 ? '' : 's'} still use this ${config.label.toLowerCase()}`,
          );
        }
      }

      await config.model.deleteOne({ ...orgFilter(ctx), _id: id });
      sendSuccess(res, { deleted: true }, `${config.label} deleted`);
    },
  );

  return router;
}

const nameField = z.string().trim().min(1, 'Enter a name').max(80);

const categorySchema = z.object({
  name: nameField,
  parentId: objectIdSchema.optional(),
  description: z.string().trim().max(240).optional(),
  isActive: z.boolean().optional(),
});

const brandSchema = z.object({
  name: nameField,
  description: z.string().trim().max(240).optional(),
  isActive: z.boolean().optional(),
});

const unitSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(40),
  symbol: z.string().trim().min(1, 'Enter a short form').max(12),
  allowsDecimal: z.boolean().default(false),
  isActive: z.boolean().optional(),
});

export const categoriesRouter = Router();
categoriesRouter.use(authenticate);
categoriesRouter.use(
  buildMasterRouter({
    model: Category as unknown as Model<MasterDocument>,
    label: 'Category',
    createSchema: categorySchema,
    updateSchema: categorySchema.partial(),
    createdAction: AUDIT_ACTIONS.CATEGORY_CREATED,
    updatedAction: AUDIT_ACTIONS.CATEGORY_UPDATED,
    managePermission: PERMISSIONS.PRODUCTS_CREATE,
    searchFields: ['name'],
    sortableFields: ['name', 'createdAt'],
    denormalizedField: 'categoryName',
    productForeignKey: 'categoryId',
  }),
);

export const brandsRouter = Router();
brandsRouter.use(authenticate);
brandsRouter.use(
  buildMasterRouter({
    model: Brand as unknown as Model<MasterDocument>,
    label: 'Brand',
    createSchema: brandSchema,
    updateSchema: brandSchema.partial(),
    createdAction: AUDIT_ACTIONS.BRAND_CREATED,
    updatedAction: AUDIT_ACTIONS.BRAND_UPDATED,
    managePermission: PERMISSIONS.PRODUCTS_CREATE,
    searchFields: ['name'],
    sortableFields: ['name', 'createdAt'],
    denormalizedField: 'brandName',
    productForeignKey: 'brandId',
  }),
);

export const unitsRouter = Router();
unitsRouter.use(authenticate);
unitsRouter.use(
  buildMasterRouter({
    model: Unit as unknown as Model<MasterDocument>,
    label: 'Unit',
    createSchema: unitSchema,
    updateSchema: unitSchema.partial(),
    createdAction: AUDIT_ACTIONS.UNIT_CREATED,
    updatedAction: AUDIT_ACTIONS.UNIT_UPDATED,
    managePermission: PERMISSIONS.PRODUCTS_CREATE,
    searchFields: ['name', 'symbol'],
    sortableFields: ['name'],
    productForeignKey: 'unitId',
  }),
);
