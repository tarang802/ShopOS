import {
  PURCHASE_ORDER_STATUSES,
  daysOverdue,
  derivePayableStatus,
  purchaseCreditDuePaise,
  purchaseOwedPaise,
  purchasePayableCapPaise,
} from '@shopos/shared';
import type { IPurchaseOrder } from '../../db/models';

/**
 * A purchase order as the API returns it: what is owed to the supplier worked out
 * from the shared arithmetic rather than stored.
 */
export function presentPurchaseOrder(po: IPurchaseOrder, now: Date = new Date()) {
  const amounts = {
    totalPaise: po.totalPaise,
    receivedValuePaise: po.receivedValuePaise ?? 0,
    returnedPaise: po.returnedPaise ?? 0,
    paidPaise: po.paidPaise ?? 0,
  };
  const cancelled = po.status === PURCHASE_ORDER_STATUSES.CANCELLED;
  const owedPaise = cancelled ? 0 : purchaseOwedPaise(amounts);

  return {
    ...po,
    owedPaise,
    payableCapPaise: cancelled ? 0 : purchasePayableCapPaise(amounts),
    creditDuePaise: purchaseCreditDuePaise(amounts),
    payableStatus: derivePayableStatus(amounts),
    overdueDays: owedPaise > 0 && po.dueDate ? daysOverdue(po.dueDate, now) : 0,
  };
}
