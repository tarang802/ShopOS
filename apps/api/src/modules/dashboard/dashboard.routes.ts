import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectIdSchema } from '@shopos/shared';
import { AuditLog, Branch, InventoryTransaction, Product } from '../../db/models';
import { validate, query } from '../../middleware/validate';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { sendSuccess } from '../../core/http';
import { orgFilter } from '../../core/tenantContext';
import * as inventoryService from '../inventory/inventory.service';
import * as pricingService from '../pricing/pricing.service';

/**
 * The opening screen.
 *
 * Every figure here is a cheap, indexed query - a count or a small top-N. None
 * of it scans a large collection. Once there are sales to summarise, those
 * totals will come from pre-aggregated daily rollups rather than from the
 * invoice collection, for the same reason: a dashboard that gets slower as the
 * business grows is a dashboard people stop opening.
 */

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

dashboardRouter.get(
  '/',
  requirePermission(PERMISSIONS.PRODUCTS_VIEW),
  validate({ query: z.object({ branchId: objectIdSchema.optional() }) }),
  async (req: Request, res: Response) => {
    const ctx = requireContext(req);
    const { branchId } = query<{ branchId?: string }>(req);

    const branchScope = ctx.allBranches ? {} : { _id: { $in: ctx.branchIds } };

    const [productCount, branchCount, stock, recentMovements, recentPrices, recentActivity] =
      await Promise.all([
        Product.countDocuments({ ...orgFilter(ctx), isActive: true }),
        Branch.countDocuments({ ...orgFilter(ctx), isActive: true, ...branchScope }),
        inventoryService.stockSummary(ctx, branchId),
        InventoryTransaction.find({
          ...orgFilter(ctx),
          ...(ctx.allBranches ? {} : { branchId: { $in: ctx.branchIds } }),
        })
          .sort({ occurredAt: -1 })
          .limit(8)
          .lean(),
        ctx.permissions.has(PERMISSIONS.PRICING_VIEW)
          ? pricingService.recentPriceUpdates(ctx, 6)
          : Promise.resolve([]),
        ctx.permissions.has(PERMISSIONS.AUDIT_LOGS_VIEW)
          ? AuditLog.find(orgFilter(ctx)).sort({ createdAt: -1 }).limit(8).lean()
          : Promise.resolve([]),
      ]);

    sendSuccess(res, {
      productCount,
      branchCount,
      stock,
      recentMovements,
      recentPriceUpdates: recentPrices,
      recentActivity,
    });
  },
);
