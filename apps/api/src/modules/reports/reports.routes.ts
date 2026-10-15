import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectIdSchema, type Permission } from '@shopos/shared';
import { authenticate, requireContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { AppError } from '../../core/AppError';
import { sendSuccess } from '../../core/http';
import type { TenantContext } from '../../core/tenantContext';
import { toCsv } from './csv';
import type { ReportResult } from './reportTypes';
import * as service from './reports.service';

/**
 * Report endpoints.
 *
 * One generic route serves every report, driven by the catalogue below: each entry
 * names its filters, validates its own query and runs its own aggregation. Adding
 * a report is adding an entry here and a function in the service - no new route,
 * no new screen, because the result is always the same column-and-row shape.
 *
 * `?format=csv` returns the same result as a spreadsheet.
 */

const dateParam = z.coerce.date();

const baseFilters = {
  from: dateParam.optional(),
  to: dateParam.optional(),
  branchId: objectIdSchema.optional(),
};

interface ReportDefinition {
  title: string;
  description: string;
  /** What the filters mean, so the web can build a form from the catalogue. */
  filters: ('period' | 'branch')[];
  groupBy?: { options: string[]; default: string };
  /** Extra permission beyond reports:view. */
  requires?: string;
  schema: z.ZodObject<z.ZodRawShape>;
  run: (ctx: TenantContext, query: never) => Promise<ReportResult>;
}

const REPORTS: Record<string, ReportDefinition> = {
  'sales-summary': {
    title: 'Sales',
    description: 'What was sold, by day, month, product, customer or branch - with margin if you may see costs',
    filters: ['period', 'branch'],
    groupBy: { options: ['day', 'month', 'product', 'customer', 'branch'], default: 'day' },
    schema: z.object({
      ...baseFilters,
      groupBy: z.enum(['day', 'month', 'product', 'customer', 'branch']).default('day'),
      limit: z.coerce.number().int().min(1).max(5000).optional(),
    }),
    run: service.salesSummary,
  },
  'tax-summary': {
    title: 'Tax collected',
    description: 'Tax charged on sales, grouped by rate, after returns',
    filters: ['period', 'branch'],
    schema: z.object(baseFilters),
    run: service.taxSummary,
  },
  collections: {
    title: 'Money received',
    description: 'Payments received from customers, by method, day or branch',
    filters: ['period', 'branch'],
    groupBy: { options: ['method', 'day', 'branch'], default: 'method' },
    schema: z.object({ ...baseFilters, groupBy: z.enum(['method', 'day', 'branch']).default('method') }),
    run: service.collectionsSummary,
  },
  'receivables-aging': {
    title: 'Who owes us',
    description: 'Customers with money outstanding, by how late it is',
    filters: ['branch'],
    schema: z.object({ branchId: objectIdSchema.optional() }),
    run: service.receivablesAging,
  },
  'payables-aging': {
    title: 'Whom we owe',
    description: 'Suppliers owed money, by how late it is',
    filters: ['branch'],
    schema: z.object({ branchId: objectIdSchema.optional() }),
    run: service.payablesAging,
  },
  'purchases-summary': {
    title: 'Purchases',
    description: 'Orders placed, goods received, returned and paid, by supplier, day, month or branch',
    filters: ['period', 'branch'],
    groupBy: { options: ['month', 'day', 'supplier', 'branch'], default: 'month' },
    schema: z.object({
      ...baseFilters,
      groupBy: z.enum(['day', 'month', 'supplier', 'branch']).default('month'),
    }),
    run: service.purchasesSummary,
  },
  'stock-valuation': {
    title: 'Stock value',
    description: 'What the stock on the shelves is worth at cost, by product, branch or category',
    filters: ['branch'],
    groupBy: { options: ['product', 'branch', 'category'], default: 'category' },
    requires: PERMISSIONS.COSTS_VIEW,
    schema: z.object({
      branchId: objectIdSchema.optional(),
      groupBy: z.enum(['product', 'branch', 'category']).default('category'),
    }),
    run: service.stockValuation,
  },
  reorder: {
    title: 'Reorder list',
    description: 'Products that have fallen to or below their reorder level',
    filters: ['branch'],
    schema: z.object({ branchId: objectIdSchema.optional() }),
    run: service.reorderReport,
  },
};

const formatSchema = z.object({ format: z.enum(['json', 'csv']).default('json') });

export const reportsRouter = Router();
reportsRouter.use(authenticate, requirePermission(PERMISSIONS.REPORTS_VIEW));

/** The reports this person may run, so the web can list them without hard-coding. */
reportsRouter.get('/', (req: Request, res: Response) => {
  const ctx = requireContext(req);
  const available = Object.entries(REPORTS)
    .filter(([, report]) => !report.requires || ctx.permissions.has(report.requires as Permission))
    .map(([key, report]) => ({
      key,
      title: report.title,
      description: report.description,
      filters: report.filters,
      ...(report.groupBy ? { groupBy: report.groupBy } : {}),
    }));
  sendSuccess(res, available);
});

reportsRouter.get('/:key', async (req: Request, res: Response) => {
  const ctx = requireContext(req);
  const key = String(req.params.key);
  const definition = REPORTS[key];
  if (!definition) throw AppError.notFound('Report');

  if (definition.requires && !ctx.permissions.has(definition.requires as Permission)) {
    throw AppError.permissionDenied(definition.requires);
  }

  const parsed = definition.schema.merge(formatSchema).safeParse(req.query);
  if (!parsed.success) {
    throw AppError.validation(
      'The report filters are not valid',
      parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  }

  const { format, ...filters } = parsed.data as { format: 'json' | 'csv' } & Record<string, unknown>;
  const report = await definition.run(ctx, filters as never);

  if (format === 'csv') {
    const stamp = report.period
      ? `${report.period.from.toISOString().slice(0, 10)}_${report.period.to.toISOString().slice(0, 10)}`
      : new Date().toISOString().slice(0, 10);
    res
      .status(200)
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${key}_${stamp}.csv"`)
      .send(toCsv(report));
    return;
  }

  sendSuccess(res, report);
});
