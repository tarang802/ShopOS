import { Types, type PipelineStage } from 'mongoose';
import {
  INVOICE_STATUSES,
  PAYMENT_STATUSES,
  PERMISSIONS,
  PURCHASE_ORDER_STATUSES,
  calendarRange,
  startOfDayInTimeZone,
} from '@shopos/shared';
import {
  Branch,
  InventoryBalance,
  Invoice,
  Organization,
  Payment,
  PurchaseOrder,
} from '../../db/models';
import { AppError } from '../../core/AppError';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { OPEN_INVOICE_STATUSES, OUTSTANDING_EXPRESSION } from '../../services/receivablesService';
import { OWED_EXPRESSION, PAYABLE_ORDER_STATUSES } from '../../services/payablesService';
import {
  MAX_REPORT_ROWS,
  type ReportColumn,
  type ReportResult,
  type ReportRow,
} from './reportTypes';

/**
 * Reports.
 *
 * Every report is a database aggregation that begins with a `$match` on the
 * organization - the tenant guard cannot see inside a pipeline, so scoping each one
 * is the author's job and always comes first - and then on the branches the caller
 * works in. They run on the database, never by loading documents into Node.
 *
 * Periods are calendar dates in the business's own timezone, so "1 to 31 October"
 * means those days in India, not in UTC.
 */

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 3 * 366;

interface Period {
  from: Date;
  to: Date;
  timeZone: string;
}

async function resolvePeriod(ctx: TenantContext, from?: Date, to?: Date): Promise<Period> {
  const organization = await Organization.findById(ctx.organizationId).select('timezone').lean();
  const timeZone = organization?.timezone ?? 'Asia/Kolkata';

  const range = calendarRange(from, to, timeZone);
  const end = range.to ?? new Date();
  const start = range.from ?? startOfDayInTimeZone(new Date(end.getTime() - 29 * DAY_MS), timeZone);

  if (start.getTime() > end.getTime()) {
    throw AppError.badRequest('The start date is after the end date');
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw AppError.badRequest('Choose a range of three years or less');
  }

  return { from: start, to: end, timeZone };
}

function branchMatch(ctx: TenantContext, branchId?: string): Record<string, unknown> {
  if (branchId) {
    const id = new Types.ObjectId(branchId);
    assertBranchAccess(ctx, id);
    return { branchId: id };
  }
  return ctx.allBranches ? {} : { branchId: { $in: ctx.branchIds } };
}

function cap<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  return rows.length > MAX_REPORT_ROWS
    ? { rows: rows.slice(0, MAX_REPORT_ROWS), truncated: true }
    : { rows, truncated: false };
}

/** Add up the numeric columns the report names. */
function sumColumns(rows: ReportRow[], keys: string[]): ReportRow {
  const totals: ReportRow = {};
  for (const key of keys) {
    totals[key] = rows.reduce((sum, row) => sum + (typeof row[key] === 'number' ? (row[key] as number) : 0), 0);
  }
  return totals;
}

/* -------------------------------------------------------------------------- */
/* Sales                                                                       */
/* -------------------------------------------------------------------------- */

export type SalesGroupBy = 'day' | 'month' | 'product' | 'customer' | 'branch';

export interface SalesSummaryInput {
  from?: Date;
  to?: Date;
  branchId?: string;
  groupBy: SalesGroupBy;
  limit?: number;
}

const SALES_GROUP_LABELS: Record<SalesGroupBy, string> = {
  day: 'Date',
  month: 'Month',
  product: 'Product',
  customer: 'Customer',
  branch: 'Branch',
};

function salesGroupStage(groupBy: SalesGroupBy | 'all', timeZone: string) {
  switch (groupBy) {
    case 'day': {
      const day = { $dateToString: { format: '%Y-%m-%d', date: '$invoiceDate', timezone: timeZone } };
      return { id: day, label: { $first: day } };
    }
    case 'month': {
      const month = { $dateToString: { format: '%Y-%m', date: '$invoiceDate', timezone: timeZone } };
      return { id: month, label: { $first: month } };
    }
    case 'product':
      return { id: '$items.productId', label: { $first: '$items.productName' }, sku: { $first: '$items.sku' } };
    case 'customer':
      return { id: '$customerId', label: { $first: '$customerName' } };
    case 'branch':
      return { id: '$branchId', label: { $first: '$branchName' } };
    default:
      return { id: null, label: { $first: 'Total' } };
  }
}

function salesPipeline(
  ctx: TenantContext,
  period: Period,
  branch: Record<string, unknown>,
  groupBy: SalesGroupBy | 'all',
): PipelineStage[] {
  const group = salesGroupStage(groupBy, period.timeZone);

  return [
    {
      $match: {
        ...orgFilter(ctx),
        ...branch,
        status: { $ne: INVOICE_STATUSES.CANCELLED },
        invoiceDate: { $gte: period.from, $lte: period.to },
      },
    },
    { $unwind: '$items' },
    {
      $addFields: {
        netQty: { $subtract: ['$items.quantity', { $ifNull: ['$items.returnedQty', 0] }] },
      },
    },
    {
      $addFields: {
        // The share of the line that was kept. Everything below is the line's own
        // frozen amount times this, so a returned half is half the credit.
        kept: {
          $cond: [{ $gt: ['$items.quantity', 0] }, { $divide: ['$netQty', '$items.quantity'] }, 0],
        },
      },
    },
    {
      $group: {
        _id: group.id,
        label: group.label,
        ...('sku' in group ? { sku: group.sku } : {}),
        invoices: { $addToSet: '$_id' },
        units: { $sum: '$netQty' },
        grossPaise: {
          $sum: { $multiply: [{ $ifNull: ['$items.grossPaise', '$items.subtotalPaise'] }, '$kept'] },
        },
        discountPaise: { $sum: { $multiply: [{ $ifNull: ['$items.discountPaise', 0] }, '$kept'] } },
        soldPaise: { $sum: '$items.lineTotalPaise' },
        netPaise: { $sum: { $multiply: ['$items.subtotalPaise', '$kept'] } },
        taxPaise: { $sum: { $multiply: ['$items.taxPaise', '$kept'] } },
        totalPaise: { $sum: { $multiply: ['$items.lineTotalPaise', '$kept'] } },
        costPaise: { $sum: { $multiply: [{ $ifNull: ['$items.unitCostPaise', 0] }, '$netQty'] } },
      },
    },
  ];
}

function salesRow(raw: Record<string, unknown>, showCost: boolean): ReportRow {
  const n = (key: string) => Math.round((raw[key] as number) ?? 0);
  const net = n('netPaise');
  const cost = n('costPaise');

  return {
    label: (raw.label as string) ?? 'Walk-in Customer',
    ...(raw.sku ? { sku: raw.sku as string } : {}),
    invoices: (raw.invoices as unknown[]).length,
    units: Math.round(((raw.units as number) ?? 0) * 1000) / 1000,
    grossPaise: n('grossPaise'),
    discountPaise: n('discountPaise'),
    returnsPaise: n('soldPaise') - n('totalPaise'),
    netPaise: net,
    taxPaise: n('taxPaise'),
    totalPaise: n('totalPaise'),
    ...(showCost
      ? {
          costPaise: cost,
          marginPaise: net - cost,
          marginPercent: net > 0 ? ((net - cost) / net) * 100 : 0,
        }
      : {}),
  };
}

export async function salesSummary(ctx: TenantContext, input: SalesSummaryInput): Promise<ReportResult> {
  const period = await resolvePeriod(ctx, input.from, input.to);
  const branch = branchMatch(ctx, input.branchId);
  const showCost = ctx.permissions.has(PERMISSIONS.COSTS_VIEW);
  const timeBased = input.groupBy === 'day' || input.groupBy === 'month';

  const sortStage: PipelineStage = timeBased ? { $sort: { _id: 1 } } : { $sort: { netPaise: -1 } };
  const limit = Math.min(input.limit ?? MAX_REPORT_ROWS, MAX_REPORT_ROWS);

  const [grouped, overall] = await Promise.all([
    Invoice.aggregate([
      ...salesPipeline(ctx, period, branch, input.groupBy),
      sortStage,
      { $limit: limit + 1 },
    ]),
    Invoice.aggregate(salesPipeline(ctx, period, branch, 'all')),
  ]);

  const capped = cap(grouped.map((row) => salesRow(row, showCost)));
  const totals = overall[0] ? salesRow(overall[0], showCost) : undefined;
  if (totals) delete (totals as Record<string, unknown>).label;

  const columns: ReportColumn[] = [
    { key: 'label', label: SALES_GROUP_LABELS[input.groupBy], type: 'text' },
    ...(input.groupBy === 'product' ? [{ key: 'sku', label: 'Item code', type: 'text' as const }] : []),
    { key: 'invoices', label: 'Invoices', type: 'number' },
    { key: 'units', label: 'Units', type: 'number' },
    { key: 'grossPaise', label: 'Gross', type: 'money' },
    { key: 'discountPaise', label: 'Discount', type: 'money' },
    { key: 'returnsPaise', label: 'Returns', type: 'money' },
    { key: 'netPaise', label: 'Net sales', type: 'money' },
    { key: 'taxPaise', label: 'Tax', type: 'money' },
    { key: 'totalPaise', label: 'Total', type: 'money' },
    ...(showCost
      ? [
          { key: 'costPaise', label: 'Cost', type: 'money' as const },
          { key: 'marginPaise', label: 'Margin', type: 'money' as const },
          { key: 'marginPercent', label: 'Margin %', type: 'percent' as const },
        ]
      : []),
  ];

  return {
    key: 'sales-summary',
    title: `Sales by ${SALES_GROUP_LABELS[input.groupBy].toLowerCase()}`,
    period: { from: period.from, to: period.to },
    columns,
    rows: capped.rows,
    ...(totals ? { totals } : {}),
    truncated: capped.truncated,
    notes: [
      'Net sales is before tax and after returns. Total includes tax.',
      ...(showCost ? [] : ['Cost and margin are hidden because you do not have the costs permission.']),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Tax                                                                         */
/* -------------------------------------------------------------------------- */

export async function taxSummary(
  ctx: TenantContext,
  input: { from?: Date; to?: Date; branchId?: string },
): Promise<ReportResult> {
  const period = await resolvePeriod(ctx, input.from, input.to);
  const branch = branchMatch(ctx, input.branchId);

  const grouped = await Invoice.aggregate<{ _id: number; taxable: number; tax: number; lines: number }>([
    {
      $match: {
        ...orgFilter(ctx),
        ...branch,
        status: { $ne: INVOICE_STATUSES.CANCELLED },
        invoiceDate: { $gte: period.from, $lte: period.to },
      },
    },
    { $unwind: '$items' },
    {
      $addFields: {
        kept: {
          $cond: [
            { $gt: ['$items.quantity', 0] },
            {
              $divide: [
                { $subtract: ['$items.quantity', { $ifNull: ['$items.returnedQty', 0] }] },
                '$items.quantity',
              ],
            },
            0,
          ],
        },
      },
    },
    {
      $group: {
        _id: '$items.taxRatePercent',
        taxable: { $sum: { $multiply: ['$items.subtotalPaise', '$kept'] } },
        tax: { $sum: { $multiply: ['$items.taxPaise', '$kept'] } },
        lines: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const rows: ReportRow[] = grouped.map((row) => ({
    ratePercent: row._id,
    lines: row.lines,
    taxablePaise: Math.round(row.taxable),
    taxPaise: Math.round(row.tax),
  }));

  return {
    key: 'tax-summary',
    title: 'Tax collected by rate',
    period: { from: period.from, to: period.to },
    columns: [
      { key: 'ratePercent', label: 'Tax rate %', type: 'number' },
      { key: 'lines', label: 'Invoice lines', type: 'number' },
      { key: 'taxablePaise', label: 'Taxable value', type: 'money' },
      { key: 'taxPaise', label: 'Tax collected', type: 'money' },
    ],
    rows,
    totals: sumColumns(rows, ['lines', 'taxablePaise', 'taxPaise']),
    notes: [
      'Tax on goods sold, after returns. Tax paid on purchases is not tracked, so this is not a net GST figure.',
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Money in                                                                    */
/* -------------------------------------------------------------------------- */

export type CollectionsGroupBy = 'method' | 'day' | 'branch';

export async function collectionsSummary(
  ctx: TenantContext,
  input: { from?: Date; to?: Date; branchId?: string; groupBy: CollectionsGroupBy },
): Promise<ReportResult> {
  const period = await resolvePeriod(ctx, input.from, input.to);
  const branch = branchMatch(ctx, input.branchId);

  const keys = {
    method: { id: '$method', label: '$method' },
    day: {
      id: { $dateToString: { format: '%Y-%m-%d', date: '$paymentDate', timezone: period.timeZone } },
      label: { $dateToString: { format: '%Y-%m-%d', date: '$paymentDate', timezone: period.timeZone } },
    },
    branch: { id: '$branchId', label: '$branchId' },
  } as const;

  const grouped = await Payment.aggregate<{ _id: unknown; count: number; amount: number }>([
    {
      $match: {
        ...orgFilter(ctx),
        ...branch,
        status: PAYMENT_STATUSES.RECORDED,
        paymentDate: { $gte: period.from, $lte: period.to },
      },
    },
    { $group: { _id: keys[input.groupBy].id, count: { $sum: 1 }, amount: { $sum: '$amountPaise' } } },
    { $sort: input.groupBy === 'day' ? { _id: 1 } : { amount: -1 } },
  ]);

  let names = new Map<string, string>();
  if (input.groupBy === 'branch') {
    const branches = await Branch.find({ ...orgFilter(ctx) }).select('name').lean();
    names = new Map(branches.map((b) => [b._id.toString(), b.name]));
  }

  const rows: ReportRow[] = grouped.map((row) => ({
    label:
      input.groupBy === 'branch'
        ? (names.get(String(row._id)) ?? 'Unknown branch')
        : input.groupBy === 'method'
          ? String(row._id).replace('_', ' ')
          : String(row._id),
    payments: row.count,
    amountPaise: row.amount,
  }));

  return {
    key: 'collections',
    title: `Money received by ${input.groupBy}`,
    period: { from: period.from, to: period.to },
    columns: [
      {
        key: 'label',
        label: input.groupBy === 'day' ? 'Date' : input.groupBy === 'method' ? 'Method' : 'Branch',
        type: 'text',
      },
      { key: 'payments', label: 'Payments', type: 'number' },
      { key: 'amountPaise', label: 'Amount', type: 'money' },
    ],
    rows,
    totals: sumColumns(rows, ['payments', 'amountPaise']),
    notes: ['Voided payments are not counted.'],
  };
}

/* -------------------------------------------------------------------------- */
/* Aging                                                                       */
/* -------------------------------------------------------------------------- */

const AGING_COLUMNS = (partyLabel: string, countLabel: string): ReportColumn[] => [
  { key: 'label', label: partyLabel, type: 'text' },
  { key: 'count', label: countLabel, type: 'number' },
  { key: 'currentPaise', label: 'Not yet due', type: 'money' },
  { key: 'd1_30Paise', label: '1-30 days', type: 'money' },
  { key: 'd31_60Paise', label: '31-60 days', type: 'money' },
  { key: 'd61_90Paise', label: '61-90 days', type: 'money' },
  { key: 'd90PlusPaise', label: 'Over 90 days', type: 'money' },
  { key: 'totalPaise', label: 'Total', type: 'money' },
];

const AGING_KEYS = ['count', 'currentPaise', 'd1_30Paise', 'd31_60Paise', 'd61_90Paise', 'd90PlusPaise', 'totalPaise'];

/** Group an amount into the aging buckets by how many days past due it is. */
function agingGroupFields(amount: string) {
  const bucket = (low: number, high: number | null) => ({
    $sum: {
      $cond: [
        high === null
          ? { $gt: ['$overdueDays', low] }
          : { $and: [{ $gt: ['$overdueDays', low] }, { $lte: ['$overdueDays', high] }] },
        amount,
        0,
      ],
    },
  });

  return {
    count: { $sum: 1 },
    currentPaise: { $sum: { $cond: [{ $lte: ['$overdueDays', 0] }, amount, 0] } },
    d1_30Paise: bucket(0, 30),
    d31_60Paise: bucket(30, 60),
    d61_90Paise: bucket(60, 90),
    d90PlusPaise: bucket(90, null),
    totalPaise: { $sum: amount },
  };
}

function overdueDaysExpression(asOf: Date, dateField: string) {
  return {
    $max: [0, { $ceil: { $divide: [{ $subtract: [asOf, dateField] }, DAY_MS] } }],
  };
}

function agingRows(grouped: Record<string, unknown>[]): ReportRow[] {
  return grouped.map((row) => ({
    label: (row.label as string) ?? 'Walk-in Customer',
    count: row.count as number,
    currentPaise: Math.round(row.currentPaise as number),
    d1_30Paise: Math.round(row.d1_30Paise as number),
    d31_60Paise: Math.round(row.d31_60Paise as number),
    d61_90Paise: Math.round(row.d61_90Paise as number),
    d90PlusPaise: Math.round(row.d90PlusPaise as number),
    totalPaise: Math.round(row.totalPaise as number),
  }));
}

export async function receivablesAging(
  ctx: TenantContext,
  input: { branchId?: string },
): Promise<ReportResult> {
  const branch = branchMatch(ctx, input.branchId);
  const asOf = new Date();

  const grouped = await Invoice.aggregate([
    { $match: { ...orgFilter(ctx), ...branch, status: { $in: [...OPEN_INVOICE_STATUSES] } } },
    { $addFields: { owing: OUTSTANDING_EXPRESSION, overdueDays: overdueDaysExpression(asOf, '$dueDate') } },
    { $match: { owing: { $gt: 0 } } },
    {
      $group: {
        _id: '$customerId',
        label: { $first: '$customerName' },
        ...agingGroupFields('$owing'),
      },
    },
    { $sort: { totalPaise: -1 } },
    { $limit: MAX_REPORT_ROWS + 1 },
  ]);

  const capped = cap(agingRows(grouped));
  return {
    key: 'receivables-aging',
    title: 'What customers owe, by how late it is',
    columns: AGING_COLUMNS('Customer', 'Invoices'),
    rows: capped.rows,
    totals: sumColumns(capped.rows, AGING_KEYS),
    truncated: capped.truncated,
    notes: [`As of ${asOf.toDateString()}. Days are counted from each invoice's due date.`],
  };
}

export async function payablesAging(
  ctx: TenantContext,
  input: { branchId?: string },
): Promise<ReportResult> {
  const branch = branchMatch(ctx, input.branchId);
  const asOf = new Date();

  const grouped = await PurchaseOrder.aggregate([
    { $match: { ...orgFilter(ctx), ...branch, status: { $in: [...PAYABLE_ORDER_STATUSES] } } },
    { $addFields: { owing: OWED_EXPRESSION, overdueDays: overdueDaysExpression(asOf, '$dueDate') } },
    { $match: { owing: { $gt: 0 } } },
    {
      $group: {
        _id: '$supplierId',
        label: { $first: '$supplierName' },
        ...agingGroupFields('$owing'),
      },
    },
    { $sort: { totalPaise: -1 } },
    { $limit: MAX_REPORT_ROWS + 1 },
  ]);

  const capped = cap(agingRows(grouped));
  return {
    key: 'payables-aging',
    title: 'What is owed to suppliers, by how late it is',
    columns: AGING_COLUMNS('Supplier', 'Orders'),
    rows: capped.rows,
    totals: sumColumns(capped.rows, AGING_KEYS),
    truncated: capped.truncated,
    notes: [
      `As of ${asOf.toDateString()}. Only goods actually received count as owed; days run from the first delivery plus the supplier's credit days.`,
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Purchases                                                                   */
/* -------------------------------------------------------------------------- */

export type PurchasesGroupBy = 'day' | 'month' | 'supplier' | 'branch';

export async function purchasesSummary(
  ctx: TenantContext,
  input: { from?: Date; to?: Date; branchId?: string; groupBy: PurchasesGroupBy },
): Promise<ReportResult> {
  const period = await resolvePeriod(ctx, input.from, input.to);
  const branch = branchMatch(ctx, input.branchId);

  const keys = {
    day: {
      id: { $dateToString: { format: '%Y-%m-%d', date: '$orderDate', timezone: period.timeZone } },
      label: {
        $first: { $dateToString: { format: '%Y-%m-%d', date: '$orderDate', timezone: period.timeZone } },
      },
    },
    month: {
      id: { $dateToString: { format: '%Y-%m', date: '$orderDate', timezone: period.timeZone } },
      label: {
        $first: { $dateToString: { format: '%Y-%m', date: '$orderDate', timezone: period.timeZone } },
      },
    },
    supplier: { id: '$supplierId', label: { $first: '$supplierName' } },
    branch: { id: '$branchId', label: { $first: '$branchName' } },
  } as const;
  const key = keys[input.groupBy];

  const grouped = await PurchaseOrder.aggregate<Record<string, unknown>>([
    {
      $match: {
        ...orgFilter(ctx),
        ...branch,
        status: {
          $in: [
            PURCHASE_ORDER_STATUSES.SENT,
            PURCHASE_ORDER_STATUSES.PARTIALLY_RECEIVED,
            PURCHASE_ORDER_STATUSES.RECEIVED,
          ],
        },
        orderDate: { $gte: period.from, $lte: period.to },
      },
    },
    {
      $group: {
        _id: key.id,
        label: key.label,
        orders: { $sum: 1 },
        orderedPaise: { $sum: '$totalPaise' },
        receivedPaise: { $sum: { $ifNull: ['$receivedValuePaise', 0] } },
        returnedPaise: { $sum: { $ifNull: ['$returnedPaise', 0] } },
        paidPaise: { $sum: { $ifNull: ['$paidPaise', 0] } },
        owedPaise: { $sum: OWED_EXPRESSION },
      },
    },
    { $sort: input.groupBy === 'day' || input.groupBy === 'month' ? { _id: 1 } : { receivedPaise: -1 } },
    { $limit: MAX_REPORT_ROWS + 1 },
  ]);

  const capped = cap(
    grouped.map((row) => ({
      label: row.label as string,
      orders: row.orders as number,
      orderedPaise: row.orderedPaise as number,
      receivedPaise: row.receivedPaise as number,
      returnedPaise: row.returnedPaise as number,
      paidPaise: row.paidPaise as number,
      owedPaise: row.owedPaise as number,
    })),
  );

  const labels: Record<PurchasesGroupBy, string> = {
    day: 'Date',
    month: 'Month',
    supplier: 'Supplier',
    branch: 'Branch',
  };

  return {
    key: 'purchases-summary',
    title: `Purchases by ${labels[input.groupBy].toLowerCase()}`,
    period: { from: period.from, to: period.to },
    columns: [
      { key: 'label', label: labels[input.groupBy], type: 'text' },
      { key: 'orders', label: 'Orders', type: 'number' },
      { key: 'orderedPaise', label: 'Ordered', type: 'money' },
      { key: 'receivedPaise', label: 'Received', type: 'money' },
      { key: 'returnedPaise', label: 'Returned', type: 'money' },
      { key: 'paidPaise', label: 'Paid', type: 'money' },
      { key: 'owedPaise', label: 'Owed', type: 'money' },
    ],
    rows: capped.rows,
    totals: sumColumns(capped.rows, [
      'orders',
      'orderedPaise',
      'receivedPaise',
      'returnedPaise',
      'paidPaise',
      'owedPaise',
    ]),
    truncated: capped.truncated,
    notes: ['Draft and cancelled orders are left out.'],
  };
}

/* -------------------------------------------------------------------------- */
/* Stock                                                                       */
/* -------------------------------------------------------------------------- */

export type ValuationGroupBy = 'product' | 'branch' | 'category';

/**
 * What the stock on the shelves is worth, at cost.
 *
 * Needs the costs permission outright rather than hiding a column, because the
 * entire report is cost: without it there is nothing left to show. Negative stock
 * is valued at zero - a shelf cannot be worth less than nothing.
 */
export async function stockValuation(
  ctx: TenantContext,
  input: { branchId?: string; groupBy: ValuationGroupBy },
): Promise<ReportResult> {
  if (!ctx.permissions.has(PERMISSIONS.COSTS_VIEW)) {
    throw AppError.permissionDenied(PERMISSIONS.COSTS_VIEW);
  }
  const branch = branchMatch(ctx, input.branchId);

  const keys = {
    product: { id: '$productId', label: { $first: '$product.name' }, sku: { $first: '$product.sku' } },
    branch: { id: '$branchId', label: { $first: '$branchId' } },
    category: { id: '$product.categoryName', label: { $first: '$product.categoryName' } },
  } as const;
  const key = keys[input.groupBy];

  const grouped = await InventoryBalance.aggregate<Record<string, unknown>>([
    { $match: { ...orgFilter(ctx), ...branch } },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
    { $match: { 'product.isActive': true } },
    {
      $addFields: {
        onHand: { $max: [0, '$quantity'] },
        unitCost: { $ifNull: ['$product.costPricePaise', 0] },
      },
    },
    {
      $group: {
        _id: key.id,
        label: key.label,
        ...('sku' in key ? { sku: key.sku } : {}),
        quantity: { $sum: '$onHand' },
        valuePaise: { $sum: { $multiply: ['$onHand', '$unitCost'] } },
        unitCostPaise: { $avg: '$unitCost' },
      },
    },
    { $sort: { valuePaise: -1 } },
    { $limit: MAX_REPORT_ROWS + 1 },
  ]);

  let branchNames = new Map<string, string>();
  if (input.groupBy === 'branch') {
    const branches = await Branch.find({ ...orgFilter(ctx) }).select('name').lean();
    branchNames = new Map(branches.map((b) => [b._id.toString(), b.name]));
  }

  const capped = cap(
    grouped.map((row) => ({
      label:
        input.groupBy === 'branch'
          ? (branchNames.get(String(row.label)) ?? 'Unknown branch')
          : ((row.label as string | null) ?? 'Uncategorised'),
      ...(row.sku ? { sku: row.sku as string } : {}),
      quantity: Math.round(((row.quantity as number) ?? 0) * 1000) / 1000,
      ...(input.groupBy === 'product' ? { unitCostPaise: Math.round(row.unitCostPaise as number) } : {}),
      valuePaise: Math.round(row.valuePaise as number),
    })),
  );

  const labels: Record<ValuationGroupBy, string> = { product: 'Product', branch: 'Branch', category: 'Category' };

  return {
    key: 'stock-valuation',
    title: `Stock value by ${labels[input.groupBy].toLowerCase()}`,
    columns: [
      { key: 'label', label: labels[input.groupBy], type: 'text' },
      ...(input.groupBy === 'product'
        ? [
            { key: 'sku', label: 'Item code', type: 'text' as const },
            { key: 'unitCostPaise', label: 'Cost each', type: 'money' as const },
          ]
        : []),
      { key: 'quantity', label: 'Units on hand', type: 'number' },
      { key: 'valuePaise', label: 'Value at cost', type: 'money' },
    ],
    rows: capped.rows,
    totals: sumColumns(capped.rows, ['quantity', 'valuePaise']),
    truncated: capped.truncated,
    notes: ['Valued at the moving-average cost. Negative stock counts as zero.'],
  };
}

export async function reorderReport(
  ctx: TenantContext,
  input: { branchId?: string },
): Promise<ReportResult> {
  const branch = branchMatch(ctx, input.branchId);

  const found = await InventoryBalance.aggregate<Record<string, unknown>>([
    { $match: { ...orgFilter(ctx), ...branch } },
    { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    {
      $match: {
        'product.isActive': true,
        $expr: {
          $and: [
            { $gt: ['$product.reorderLevel', 0] },
            { $lte: ['$quantity', '$product.reorderLevel'] },
          ],
        },
      },
    },
    { $lookup: { from: 'branches', localField: 'branchId', foreignField: '_id', as: 'branch' } },
    { $unwind: '$branch' },
    {
      $project: {
        product: '$product.name',
        sku: '$product.sku',
        branch: '$branch.name',
        quantity: 1,
        reorderLevel: '$product.reorderLevel',
        shortfall: { $subtract: ['$product.reorderLevel', '$quantity'] },
      },
    },
    { $sort: { shortfall: -1 } },
    { $limit: MAX_REPORT_ROWS + 1 },
  ]);

  const capped = cap(
    found.map((row) => ({
      product: row.product as string,
      sku: row.sku as string,
      branch: row.branch as string,
      quantity: row.quantity as number,
      reorderLevel: row.reorderLevel as number,
      shortfall: row.shortfall as number,
    })),
  );

  return {
    key: 'reorder',
    title: 'Products at or below their reorder level',
    columns: [
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'sku', label: 'Item code', type: 'text' },
      { key: 'branch', label: 'Branch', type: 'text' },
      { key: 'quantity', label: 'On hand', type: 'number' },
      { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
      { key: 'shortfall', label: 'Short by', type: 'number' },
    ],
    rows: capped.rows,
    truncated: capped.truncated,
    notes: ['Products with a reorder level of zero are not tracked here.'],
  };
}
