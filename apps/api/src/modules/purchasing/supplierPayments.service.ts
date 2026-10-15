import { Types, type ClientSession } from 'mongoose';
import {
  AUDIT_ACTIONS,
  PAYMENT_STATUSES,
  purchasePayableCapPaise,
  sumPaise,
  toSkip,
  type PaginationQuery,
  type PaymentMethod,
} from '@shopos/shared';
import {
  Branch,
  PurchaseOrder,
  Supplier,
  SupplierPayment,
  type IPurchaseOrder,
} from '../../db/models';
import { AppError } from '../../core/AppError';
import { safeSearchRegex } from '../../core/listQuery';
import { assertBranchAccess, orgFilter, type TenantContext } from '../../core/tenantContext';
import { sessionOption, withTransaction } from '../../db/transaction';
import { nextDocumentNumber } from '../../services/counterService';
import { recordAudit } from '../../services/auditService';
import { PAYABLE_ORDER_STATUSES } from '../../services/payablesService';
import { amountMatches } from '../../services/receivablesService';
import { presentPurchaseOrder } from './purchaseOrderPresenter';

/**
 * Supplier payments: money out, applied to purchase orders.
 *
 * It mirrors customer payments and is held to the same standard. An order's paid
 * amount changes only through a compare-and-swap that names the amounts it read,
 * so two people paying the same supplier bill at once cannot both succeed, and a
 * payment must be fully allocated so money never leaves the books unexplained.
 * Voiding reverses a payment and leaves the original on record.
 */

export interface SupplierPaymentInput {
  branchId: string;
  supplierId: string;
  amountPaise: number;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  allocations: { purchaseOrderId: string; amountPaise: number }[];
}

async function swapOrderPaid(
  ctx: TenantContext,
  po: IPurchaseOrder & { _id: Types.ObjectId },
  newPaidPaise: number,
  session: ClientSession | undefined,
): Promise<void> {
  const swapped = await PurchaseOrder.updateOne(
    {
      ...orgFilter(ctx),
      _id: po._id,
      status: po.status,
      paidPaise: amountMatches(po.paidPaise),
      returnedPaise: amountMatches(po.returnedPaise),
    },
    { $set: { paidPaise: newPaidPaise } },
    sessionOption(session),
  );
  if (swapped.matchedCount === 0) {
    throw AppError.conflict(
      `Purchase order ${po.number} was just changed by someone else. Refresh and try again`,
    );
  }
}

export async function recordSupplierPayment(ctx: TenantContext, input: SupplierPaymentInput) {
  const branchId = new Types.ObjectId(input.branchId);
  assertBranchAccess(ctx, branchId);

  const allocatedTotal = sumPaise(input.allocations.map((a) => a.amountPaise));
  if (allocatedTotal !== input.amountPaise) {
    throw AppError.businessRule(
      `The payment of ${input.amountPaise} paise must be fully applied to orders, but ${allocatedTotal} paise was allocated`,
    );
  }
  const orderIdStrings = input.allocations.map((a) => a.purchaseOrderId);
  if (new Set(orderIdStrings).size !== orderIdStrings.length) {
    throw AppError.badRequest('Each purchase order can appear only once in a payment');
  }

  return withTransaction(async (session) => {
    // Read one after the other: MongoDB cannot start a transaction from two
    // operations running at the same moment on one session.
    const branch = await Branch.findOne({ ...orgFilter(ctx), _id: branchId })
      .select('_id')
      .session(session ?? null)
      .lean();
    const supplier = await Supplier.findOne({ ...orgFilter(ctx), _id: input.supplierId })
      .select('name')
      .session(session ?? null)
      .lean();
    if (!branch) throw AppError.notFound('Branch');
    if (!supplier) throw AppError.badRequest('Select a valid supplier');

    const orders = await PurchaseOrder.find({
      ...orgFilter(ctx),
      _id: { $in: orderIdStrings.map((id) => new Types.ObjectId(id)) },
    }).session(session ?? null);
    if (orders.length !== orderIdStrings.length) {
      throw AppError.badRequest('One or more purchase orders are not valid');
    }
    const orderById = new Map(orders.map((order) => [order._id.toString(), order]));

    for (const allocation of input.allocations) {
      const order = orderById.get(allocation.purchaseOrderId)!;
      assertBranchAccess(ctx, order.branchId);

      if (!order.supplierId.equals(supplier._id)) {
        throw AppError.businessRule(
          `Purchase order ${order.number} belongs to ${order.supplierName}, not to the supplier on this payment`,
        );
      }
      if (!(PAYABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
        throw AppError.businessRule(
          `Purchase order ${order.number} is ${order.status.toLowerCase().replace('_', ' ')} and cannot be paid`,
        );
      }

      const cap = purchasePayableCapPaise(order);
      if (allocation.amountPaise > cap) {
        throw AppError.businessRule(
          `Allocation of ${allocation.amountPaise} paise to ${order.number} exceeds the ${cap} paise that can still be paid on it`,
        );
      }
    }

    const number = await nextDocumentNumber(ctx.organizationId, 'SP', session);

    for (const allocation of input.allocations) {
      const order = orderById.get(allocation.purchaseOrderId)!;
      await swapOrderPaid(ctx, order, (order.paidPaise ?? 0) + allocation.amountPaise, session);
    }

    const [payment] = await SupplierPayment.create(
      [
        {
          ...orgFilter(ctx),
          branchId,
          supplierId: supplier._id,
          supplierName: supplier.name,
          number,
          amountPaise: input.amountPaise,
          method: input.method,
          ...(input.reference ? { reference: input.reference } : {}),
          status: PAYMENT_STATUSES.RECORDED,
          allocations: input.allocations.map((a) => ({
            purchaseOrderId: new Types.ObjectId(a.purchaseOrderId),
            purchaseOrderNumber: orderById.get(a.purchaseOrderId)!.number,
            amountPaise: a.amountPaise,
          })),
          ...(input.notes ? { notes: input.notes } : {}),
          createdBy: ctx.userId,
          createdByName: ctx.userName,
        },
      ],
      sessionOption(session),
    );
    if (!payment) throw AppError.internal('Could not record the payment');

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.SUPPLIER_PAYMENT_CREATED,
        entityType: 'SupplierPayment',
        entityId: payment._id,
        entityLabel: number,
        branchId,
        after: {
          supplierName: supplier.name,
          amountPaise: input.amountPaise,
          method: input.method,
          orders: input.allocations.length,
        },
      },
      session,
    );

    return payment.toObject();
  });
}

export async function voidSupplierPayment(
  ctx: TenantContext,
  paymentId: Types.ObjectId,
  reason?: string,
) {
  const payment = await SupplierPayment.findOne({ ...orgFilter(ctx), _id: paymentId }).lean();
  if (!payment) throw AppError.notFound('Payment');
  assertBranchAccess(ctx, payment.branchId);

  if (payment.status === PAYMENT_STATUSES.VOIDED) {
    throw AppError.businessRule('This payment has already been voided');
  }

  return withTransaction(async (session) => {
    const claimed = await SupplierPayment.updateOne(
      { ...orgFilter(ctx), _id: paymentId, status: PAYMENT_STATUSES.RECORDED },
      {
        $set: {
          status: PAYMENT_STATUSES.VOIDED,
          voidedAt: new Date(),
          voidedBy: ctx.userId,
          voidedByName: ctx.userName,
          ...(reason ? { voidReason: reason } : {}),
        },
      },
      sessionOption(session),
    );
    if (claimed.matchedCount === 0) {
      throw AppError.conflict('This payment was just voided by someone else');
    }

    for (const allocation of payment.allocations) {
      const order = await PurchaseOrder.findOne({
        ...orgFilter(ctx),
        _id: allocation.purchaseOrderId,
      }).session(session ?? null);
      if (!order) throw AppError.notFound('Purchase order');
      await swapOrderPaid(ctx, order, (order.paidPaise ?? 0) - allocation.amountPaise, session);
    }

    await recordAudit(
      ctx,
      {
        action: AUDIT_ACTIONS.SUPPLIER_PAYMENT_VOIDED,
        entityType: 'SupplierPayment',
        entityId: payment._id,
        entityLabel: payment.number,
        branchId: payment.branchId,
        after: { amountPaise: payment.amountPaise, reason },
      },
      session,
    );

    return (await SupplierPayment.findOne({ ...orgFilter(ctx), _id: paymentId })
      .session(session ?? null)
      .lean())!;
  });
}

export interface SupplierPaymentFilters {
  supplierId?: string;
  branchId?: string;
  status?: string;
  q?: string;
}

export async function listSupplierPayments(
  ctx: TenantContext,
  query: PaginationQuery,
  filters: SupplierPaymentFilters,
) {
  const filter: Record<string, unknown> = { ...orgFilter(ctx) };

  if (filters.branchId) {
    const branchId = new Types.ObjectId(filters.branchId);
    assertBranchAccess(ctx, branchId);
    filter.branchId = branchId;
  } else if (!ctx.allBranches) {
    filter.branchId = { $in: ctx.branchIds };
  }
  if (filters.supplierId) filter.supplierId = new Types.ObjectId(filters.supplierId);
  if (filters.status) filter.status = filters.status;
  if (filters.q) {
    const pattern = safeSearchRegex(filters.q);
    filter.$or = [{ number: pattern }, { supplierName: pattern }, { reference: pattern }];
  }

  const [items, total] = await Promise.all([
    SupplierPayment.find(filter)
      .sort({ paymentDate: -1, _id: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
    SupplierPayment.countDocuments(filter),
  ]);
  return { items, total, page: query.page, limit: query.limit };
}

export async function getSupplierPayment(ctx: TenantContext, paymentId: Types.ObjectId) {
  const payment = await SupplierPayment.findOne({ ...orgFilter(ctx), _id: paymentId }).lean();
  if (!payment) throw AppError.notFound('Payment');
  assertBranchAccess(ctx, payment.branchId);
  return payment;
}

/** Orders with money still owed to a supplier - what a payment screen picks from. */
export async function listPayableOrders(ctx: TenantContext, supplierId?: string) {
  const match: Record<string, unknown> = {
    ...orgFilter(ctx),
    status: { $in: [...PAYABLE_ORDER_STATUSES] },
  };
  if (!ctx.allBranches) match.branchId = { $in: ctx.branchIds };
  if (supplierId) match.supplierId = new Types.ObjectId(supplierId);

  const rows = await PurchaseOrder.aggregate<IPurchaseOrder>([
    { $match: match },
    {
      // Anything with room left to pay: owed for goods received, or open to a
      // deposit on goods not yet delivered.
      $match: {
        $expr: {
          $gt: [
            {
              $subtract: [
                '$totalPaise',
                { $add: [{ $ifNull: ['$paidPaise', 0] }, { $ifNull: ['$returnedPaise', 0] }] },
              ],
            },
            0,
          ],
        },
      },
    },
    { $sort: { dueDate: 1, orderDate: 1 } },
    { $limit: 500 },
  ]);

  const now = new Date();
  return rows.map((row) => presentPurchaseOrder(row, now));
}
