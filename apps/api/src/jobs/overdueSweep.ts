import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
  PERMISSIONS,
  QUOTATION_STATUSES,
  daysOverdue,
  invoiceOutstandingPaise,
  purchaseOwedPaise,
} from '@shopos/shared';
import { Invoice, PurchaseOrder, Quotation } from '../db/models';
import { notify, type NotificationInput } from '../services/notificationService';
import { OPEN_INVOICE_STATUSES } from '../services/receivablesService';
import { PAYABLE_ORDER_STATUSES } from '../services/payablesService';
import { logger } from '../core/logger';

/**
 * The hourly look for things that have quietly become urgent.
 *
 * Nobody performs an action when an invoice falls overdue, a supplier's payment
 * comes due or a quotation is about to lapse - time just passes. This finds them.
 *
 * It runs across every business, so it opts out of the tenant guard on purpose:
 * the one place that reads across tenants, and it only ever writes notifications
 * scoped back to the owning business. Each notification carries a dedupe key, so
 * the same overdue invoice found every hour is one notification, and two API
 * instances sweeping at once do not double up.
 */

const DAY_MS = 86_400_000;
/** A sweep looks at a bounded number of documents so one run cannot starve the process. */
const BATCH_LIMIT = 2000;

async function overdueInvoices(now: Date): Promise<NotificationInput[]> {
  const invoices = await Invoice.find({
    status: { $in: [...OPEN_INVOICE_STATUSES] },
    dueDate: { $lt: now },
  })
    .setOptions({ allowCrossTenant: true })
    .select('organizationId branchId number customerName dueDate totalPaise paidPaise returnedPaise refundedPaise')
    .sort({ dueDate: 1 })
    .limit(BATCH_LIMIT)
    .lean();

  return invoices.flatMap((invoice) => {
    const owed = invoiceOutstandingPaise(invoice);
    if (owed <= 0) return [];
    const days = daysOverdue(invoice.dueDate, now);

    return [
      {
        organizationId: invoice.organizationId,
        type: NOTIFICATION_TYPES.INVOICE_OVERDUE,
        severity: days > 30 ? NOTIFICATION_SEVERITIES.CRITICAL : NOTIFICATION_SEVERITIES.WARNING,
        title: `${invoice.customerName} is overdue`,
        body: `Invoice ${invoice.number} fell due ${days} day${days === 1 ? '' : 's'} ago`,
        link: `/sales/${invoice._id.toString()}`,
        requiredPermission: PERMISSIONS.PAYMENTS_VIEW,
        branchId: invoice.branchId,
        dedupeKey: `INVOICE_OVERDUE:${invoice._id.toString()}`,
      },
    ];
  });
}

async function payablesDueSoon(now: Date): Promise<NotificationInput[]> {
  const horizon = new Date(now.getTime() + 3 * DAY_MS);

  const orders = await PurchaseOrder.find({
    status: { $in: [...PAYABLE_ORDER_STATUSES] },
    dueDate: { $lte: horizon },
  })
    .setOptions({ allowCrossTenant: true })
    .select('organizationId branchId number supplierName dueDate totalPaise receivedValuePaise returnedPaise paidPaise')
    .sort({ dueDate: 1 })
    .limit(BATCH_LIMIT)
    .lean();

  return orders.flatMap((order) => {
    if (purchaseOwedPaise(order) <= 0 || !order.dueDate) return [];
    const overdue = order.dueDate.getTime() < now.getTime();

    return [
      {
        organizationId: order.organizationId,
        type: NOTIFICATION_TYPES.PAYABLE_DUE,
        severity: overdue ? NOTIFICATION_SEVERITIES.CRITICAL : NOTIFICATION_SEVERITIES.WARNING,
        title: overdue ? `Payment to ${order.supplierName} is overdue` : `Payment to ${order.supplierName} is due soon`,
        body: `Purchase order ${order.number}`,
        link: `/purchases/${order._id.toString()}`,
        requiredPermission: PERMISSIONS.PURCHASES_PAY,
        branchId: order.branchId,
        // The overdue stage is its own alert: someone who saw "due soon" last
        // week still needs to hear that the date has now passed.
        dedupeKey: `PAYABLE_DUE:${order._id.toString()}:${overdue ? 'overdue' : 'soon'}`,
      },
    ];
  });
}

async function quotationsExpiring(now: Date): Promise<NotificationInput[]> {
  const horizon = new Date(now.getTime() + 2 * DAY_MS);

  const quotations = await Quotation.find({
    status: QUOTATION_STATUSES.SENT,
    validUntil: { $gte: now, $lte: horizon },
  })
    .setOptions({ allowCrossTenant: true })
    .select('organizationId branchId number customerName validUntil')
    .limit(BATCH_LIMIT)
    .lean();

  return quotations.map((quotation) => ({
    organizationId: quotation.organizationId,
    type: NOTIFICATION_TYPES.QUOTATION_EXPIRING,
    severity: NOTIFICATION_SEVERITIES.INFO,
    title: `Quotation for ${quotation.customerName} expires soon`,
    body: `${quotation.number} stands until ${quotation.validUntil.toDateString()}`,
    link: `/quotations/${quotation._id.toString()}`,
    requiredPermission: PERMISSIONS.SALES_VIEW,
    branchId: quotation.branchId,
    dedupeKey: `QUOTATION_EXPIRING:${quotation._id.toString()}`,
  }));
}

export async function runOverdueSweep(now: Date = new Date()): Promise<number> {
  const [invoices, payables, quotations] = await Promise.all([
    overdueInvoices(now),
    payablesDueSoon(now),
    quotationsExpiring(now),
  ]);

  const all = [...invoices, ...payables, ...quotations];
  await notify(all);

  logger.debug(
    { invoices: invoices.length, payables: payables.length, quotations: quotations.length },
    'Overdue sweep finished',
  );
  return all.length;
}
