import { Types } from 'mongoose';
import {
  INVOICE_STATUSES,
  PAYMENT_STATUSES,
  PERMISSIONS,
  PURCHASE_ORDER_STATUSES,
  QUOTATION_STATUSES,
  SALES_ORDER_STATUSES,
  endOfDayInTimeZone,
  startOfDayInTimeZone,
} from '@shopos/shared';
import {
  Invoice,
  Organization,
  Payment,
  PurchaseOrder,
  Quotation,
  SalesOrder,
} from '../../db/models';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { OPEN_INVOICE_STATUSES, OUTSTANDING_EXPRESSION } from '../../services/receivablesService';
import { OWED_EXPRESSION, PAYABLE_ORDER_STATUSES } from '../../services/payablesService';
import { reorderReport } from '../reports/reports.service';

/**
 * The depth behind the opening screen.
 *
 * Each block answers one question an owner opens the software to ask, and each is
 * only computed for people allowed to see its subject - a stock hand never has the
 * sales figures worked out for them, let alone sent. Every figure is an indexed
 * aggregation over a bounded window, never a scan of history, so the dashboard
 * does not slow as the business grows.
 */

const DAY_MS = 86_400_000;
const TREND_DAYS = 14;

function branchMatch(ctx: TenantContext, branchId?: string): Record<string, unknown> {
  if (branchId) {
    const id = new Types.ObjectId(branchId);
    assertBranchAccess(ctx, id);
    return { branchId: id };
  }
  return ctx.allBranches ? {} : { branchId: { $in: ctx.branchIds } };
}

/** The calendar date, as YYYY-MM-DD, that an instant falls on in the business's timezone. */
function dateLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Local calendar days, newest last, each as a start instant and a YYYY-MM-DD label. */
function recentDays(now: Date, timeZone: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const instant = new Date(now.getTime() - (count - 1 - index) * DAY_MS);
    return { start: startOfDayInTimeZone(instant, timeZone), label: dateLabel(instant, timeZone) };
  });
}

export async function salesPulse(ctx: TenantContext, branch: Record<string, unknown>, timeZone: string) {
  const now = new Date();
  const days = recentDays(now, timeZone, TREND_DAYS);

  // The first of this month and of last, in the business's own calendar.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .format(now)
    .split('-')
    .map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const lastMonthStart = startOfDayInTimeZone(new Date(Date.UTC(year, month - 2, 1, 12)), timeZone);

  const earliest = new Date(Math.min(lastMonthStart.getTime(), days[0]!.start.getTime()));

  // Per-day totals from the start of last month. At most about sixty rows, which
  // every figure below is summed from - one query, not one per tile.
  const daily = await Invoice.aggregate<{ _id: string; total: number; count: number }>([
    {
      $match: {
        ...orgFilter(ctx),
        ...branch,
        status: { $ne: INVOICE_STATUSES.CANCELLED },
        invoiceDate: { $gte: earliest },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$invoiceDate', timezone: timeZone } },
        total: { $sum: { $subtract: ['$totalPaise', { $ifNull: ['$returnedPaise', 0] }] } },
        count: { $sum: 1 },
      },
    },
  ]);
  const byDay = new Map(daily.map((row) => [row._id, row]));

  const todayLabel = dateLabel(now, timeZone);
  const yesterdayLabel = dateLabel(new Date(now.getTime() - DAY_MS), timeZone);

  const sumWhere = (predicate: (label: string) => boolean) =>
    daily.filter((row) => predicate(row._id)).reduce(
      (acc, row) => ({ total: acc.total + row.total, count: acc.count + row.count }),
      { total: 0, count: 0 },
    );

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const lastMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const lastMonthPrefix = `${lastMonthDate.getUTCFullYear()}-${String(lastMonthDate.getUTCMonth() + 1).padStart(2, '0')}`;

  const today = sumWhere((label) => label === todayLabel);
  const yesterday = sumWhere((label) => label === yesterdayLabel);
  const thisMonth = sumWhere((label) => label.startsWith(monthPrefix));
  const lastMonth = sumWhere((label) => label.startsWith(lastMonthPrefix));

  return {
    today: { totalPaise: today.total, invoices: today.count },
    yesterday: { totalPaise: yesterday.total, invoices: yesterday.count },
    thisMonth: {
      totalPaise: thisMonth.total,
      invoices: thisMonth.count,
      averageBillPaise: thisMonth.count > 0 ? Math.round(thisMonth.total / thisMonth.count) : 0,
    },
    lastMonth: { totalPaise: lastMonth.total, invoices: lastMonth.count },
    /** Oldest first, every day present even when nothing was sold. */
    trend: days.map(({ label }) => ({
      date: label,
      totalPaise: byDay.get(label)?.total ?? 0,
      invoices: byDay.get(label)?.count ?? 0,
    })),
  };
}

export async function receivablesPulse(ctx: TenantContext, branch: Record<string, unknown>) {
  const now = new Date();
  const rows = await Invoice.aggregate<{
    outstanding: number;
    overdue: number;
    open: number;
    overdueCount: number;
  }>([
    { $match: { ...orgFilter(ctx), ...branch, status: { $in: [...OPEN_INVOICE_STATUSES] } } },
    { $addFields: { owing: OUTSTANDING_EXPRESSION } },
    { $match: { owing: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        outstanding: { $sum: '$owing' },
        open: { $sum: 1 },
        overdue: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, '$owing', 0] } },
        overdueCount: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, 1, 0] } },
      },
    },
  ]);

  return {
    outstandingPaise: rows[0]?.outstanding ?? 0,
    overduePaise: rows[0]?.overdue ?? 0,
    openInvoices: rows[0]?.open ?? 0,
    overdueInvoices: rows[0]?.overdueCount ?? 0,
  };
}

export async function payablesPulse(ctx: TenantContext, branch: Record<string, unknown>) {
  const now = new Date();
  const rows = await PurchaseOrder.aggregate<{
    owed: number;
    overdue: number;
    open: number;
    overdueCount: number;
  }>([
    { $match: { ...orgFilter(ctx), ...branch, status: { $in: [...PAYABLE_ORDER_STATUSES] } } },
    { $addFields: { owing: OWED_EXPRESSION } },
    { $match: { owing: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        owed: { $sum: '$owing' },
        open: { $sum: 1 },
        overdue: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, '$owing', 0] } },
        overdueCount: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, 1, 0] } },
      },
    },
  ]);

  return {
    owedPaise: rows[0]?.owed ?? 0,
    overduePaise: rows[0]?.overdue ?? 0,
    openOrders: rows[0]?.open ?? 0,
    overdueOrders: rows[0]?.overdueCount ?? 0,
  };
}

export async function topProducts(ctx: TenantContext, branch: Record<string, unknown>, limit = 5) {
  const since = new Date(Date.now() - 30 * DAY_MS);

  const rows = await Invoice.aggregate<{ _id: Types.ObjectId; name: string; units: number; net: number }>([
    {
      $match: {
        ...orgFilter(ctx),
        ...branch,
        status: { $ne: INVOICE_STATUSES.CANCELLED },
        invoiceDate: { $gte: since },
      },
    },
    { $unwind: '$items' },
    {
      $addFields: {
        netQty: { $subtract: ['$items.quantity', { $ifNull: ['$items.returnedQty', 0] }] },
      },
    },
    {
      $group: {
        _id: '$items.productId',
        name: { $first: '$items.productName' },
        units: { $sum: '$netQty' },
        net: {
          $sum: {
            $cond: [
              { $gt: ['$items.quantity', 0] },
              { $multiply: ['$items.subtotalPaise', { $divide: ['$netQty', '$items.quantity'] }] },
              0,
            ],
          },
        },
      },
    },
    { $sort: { net: -1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => ({
    productId: row._id.toString(),
    name: row.name,
    units: Math.round(row.units * 1000) / 1000,
    netPaise: Math.round(row.net),
  }));
}

export async function pendingWork(ctx: TenantContext, branch: Record<string, unknown>) {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * DAY_MS);

  const [openOrders, quotationsExpiring, awaitingDelivery] = await Promise.all([
    SalesOrder.countDocuments({
      ...orgFilter(ctx),
      ...branch,
      status: { $in: [SALES_ORDER_STATUSES.CONFIRMED, SALES_ORDER_STATUSES.PARTIALLY_INVOICED] },
    }),
    Quotation.countDocuments({
      ...orgFilter(ctx),
      ...branch,
      status: QUOTATION_STATUSES.SENT,
      validUntil: { $gte: now, $lte: soon },
    }),
    PurchaseOrder.countDocuments({
      ...orgFilter(ctx),
      ...branch,
      status: { $in: [PURCHASE_ORDER_STATUSES.SENT, PURCHASE_ORDER_STATUSES.PARTIALLY_RECEIVED] },
    }),
  ]);

  return { openSalesOrders: openOrders, quotationsExpiringSoon: quotationsExpiring, purchasesAwaitingDelivery: awaitingDelivery };
}

export async function collectedToday(ctx: TenantContext, branch: Record<string, unknown>, timeZone: string) {
  const now = new Date();
  const rows = await Payment.aggregate<{ total: number; count: number }>([
    {
      $match: {
        ...orgFilter(ctx),
        ...branch,
        status: PAYMENT_STATUSES.RECORDED,
        paymentDate: {
          $gte: startOfDayInTimeZone(now, timeZone),
          $lte: endOfDayInTimeZone(now, timeZone),
        },
      },
    },
    { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
  ]);

  return { totalPaise: rows[0]?.total ?? 0, payments: rows[0]?.count ?? 0 };
}

export async function lowStockItems(ctx: TenantContext, branchId?: string) {
  const report = await reorderReport(ctx, branchId ? { branchId } : {});
  return {
    count: report.rows.length,
    items: report.rows.slice(0, 5).map((row) => ({
      product: row.product,
      sku: row.sku,
      branch: row.branch,
      quantity: row.quantity,
      reorderLevel: row.reorderLevel,
    })),
  };
}

/** Everything the signed-in person is allowed to see, and nothing they are not. */
export async function dashboardDepth(ctx: TenantContext, branchId?: string) {
  const organization = await Organization.findById(ctx.organizationId).select('timezone').lean();
  const timeZone = organization?.timezone ?? 'Asia/Kolkata';
  const branch = branchMatch(ctx, branchId);
  const can = (permission: Parameters<TenantContext['permissions']['has']>[0]) =>
    ctx.permissions.has(permission);

  const [sales, receivables, payables, top, pending, collected, lowStock] = await Promise.all([
    can(PERMISSIONS.SALES_VIEW) ? salesPulse(ctx, branch, timeZone) : null,
    can(PERMISSIONS.PAYMENTS_VIEW) ? receivablesPulse(ctx, branch) : null,
    can(PERMISSIONS.PURCHASES_VIEW) ? payablesPulse(ctx, branch) : null,
    can(PERMISSIONS.SALES_VIEW) ? topProducts(ctx, branch) : null,
    can(PERMISSIONS.SALES_VIEW) || can(PERMISSIONS.PURCHASES_VIEW) ? pendingWork(ctx, branch) : null,
    can(PERMISSIONS.PAYMENTS_VIEW) ? collectedToday(ctx, branch, timeZone) : null,
    can(PERMISSIONS.INVENTORY_VIEW) ? lowStockItems(ctx, branchId) : null,
  ]);

  return { sales, receivables, payables, topProducts: top, pending, collectedToday: collected, lowStock };
}
