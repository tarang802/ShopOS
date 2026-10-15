import {
  INVOICE_STATUSES,
  PERMISSIONS,
  daysOverdue,
  invoiceOutstandingPaise,
  invoiceRefundDuePaise,
} from '@shopos/shared';
import type { IInvoice } from '../../db/models';
import type { TenantContext } from '../../core/tenantContext';
import { OPEN_INVOICE_STATUSES } from '../../services/receivablesService';

/**
 * An invoice as the API returns it: balances worked out, and the cost removed
 * unless the caller may see it.
 *
 * Outstanding and overdue are derived here, from the same shared arithmetic the
 * web app uses, rather than stored - a stored balance is one more number that
 * could disagree with the payments behind it.
 */
export function presentInvoice(ctx: TenantContext, invoice: IInvoice, now: Date = new Date()) {
  const showCost = ctx.permissions.has(PERMISSIONS.COSTS_VIEW);
  const amounts = {
    totalPaise: invoice.totalPaise,
    paidPaise: invoice.paidPaise,
    returnedPaise: invoice.returnedPaise ?? 0,
    refundedPaise: invoice.refundedPaise ?? 0,
  };
  const cancelled = invoice.status === INVOICE_STATUSES.CANCELLED;
  const open = (OPEN_INVOICE_STATUSES as readonly string[]).includes(invoice.status);

  return {
    ...invoice,
    items: invoice.items?.map(({ unitCostPaise, ...line }) =>
      showCost ? { ...line, unitCostPaise } : line,
    ),
    outstandingPaise: cancelled ? 0 : invoiceOutstandingPaise(amounts),
    refundDuePaise: cancelled ? 0 : invoiceRefundDuePaise(amounts),
    overdueDays: open && invoice.dueDate ? daysOverdue(invoice.dueDate, now) : 0,
  };
}
