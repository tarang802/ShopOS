import type { ClientSession } from 'mongoose';
import { SALES_ORDER_STATUSES, type SalesOrderStatus } from '@shopos/shared';
import { SalesOrder, type IInvoice } from '../../db/models';
import { sessionOption } from '../../db/transaction';
import { orgFilter, type TenantContext } from '../../core/tenantContext';

/**
 * Keeping a sales order's billed quantities in step with its invoices.
 *
 * Kept apart from the sales order service because cancelling an invoice has to
 * hand quantities back to the order it came from, and the order service itself
 * depends on the invoice service - the dependency must not run both ways.
 */

/** Quantities carry up to three decimals, so comparisons allow for float noise. */
export const QUANTITY_EPSILON = 1e-9;

/** The status an order has once confirmed, worked out from what has been billed. */
export function deriveOrderStatus(
  items: readonly { quantity: number; invoicedQty: number }[],
): SalesOrderStatus {
  if (items.every((item) => item.invoicedQty + QUANTITY_EPSILON >= item.quantity)) {
    return SALES_ORDER_STATUSES.INVOICED;
  }
  if (items.some((item) => item.invoicedQty > QUANTITY_EPSILON)) {
    return SALES_ORDER_STATUSES.PARTIALLY_INVOICED;
  }
  return SALES_ORDER_STATUSES.CONFIRMED;
}

/** Recompute an order's status from its lines and store it. */
export async function refreshOrderStatus(
  ctx: TenantContext,
  salesOrderId: IInvoice['salesOrderId'],
  session: ClientSession | undefined,
): Promise<SalesOrderStatus | undefined> {
  const order = await SalesOrder.findOne({ ...orgFilter(ctx), _id: salesOrderId })
    .session(session ?? null)
    .lean();
  if (!order || order.status === SALES_ORDER_STATUSES.CANCELLED) return undefined;

  const status = deriveOrderStatus(order.items);
  if (status !== order.status) {
    await SalesOrder.updateOne(
      { ...orgFilter(ctx), _id: order._id },
      { $set: { status } },
      sessionOption(session),
    );
  }
  return status;
}

/**
 * Hand an invoice's quantities back to its sales order.
 *
 * Called when the invoice is cancelled: the goods return to the shelf, so the
 * order again has that much waiting to be invoiced.
 */
export async function releaseOrderQuantities(
  ctx: TenantContext,
  invoice: Pick<IInvoice, 'salesOrderId' | 'items'>,
  session: ClientSession | undefined,
): Promise<void> {
  if (!invoice.salesOrderId) return;

  for (const line of invoice.items) {
    await SalesOrder.updateOne(
      { ...orgFilter(ctx), _id: invoice.salesOrderId },
      { $inc: { 'items.$[line].invoicedQty': -line.quantity } },
      { arrayFilters: [{ 'line.productId': line.productId }], ...sessionOption(session) },
    );
  }

  await refreshOrderStatus(ctx, invoice.salesOrderId, session);
}
