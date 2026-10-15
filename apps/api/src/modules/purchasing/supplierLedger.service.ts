import { Types } from 'mongoose';
import { PAYMENT_STATUSES, multiplyPaise, sumPaise } from '@shopos/shared';
import {
  GoodsReceipt,
  PurchaseOrder,
  PurchaseReturn,
  Supplier,
  SupplierPayment,
} from '../../db/models';
import { AppError } from '../../core/AppError';
import { orgFilter, type TenantContext } from '../../core/tenantContext';
import {
  buildStatement,
  endOfDay,
  type Statement,
  type StatementEntry,
} from '../../services/statementService';
import { OWED_EXPRESSION, PAYABLE_ORDER_STATUSES } from '../../services/payablesService';

/**
 * What the business owes one supplier, and the history behind it.
 *
 * The statement reads from the supplier's side: goods received increase what is
 * owed, payments and returns reduce it. Entries are built from the documents, so
 * the closing balance always equals the sum of what each order says is owed.
 */

function branchScope(ctx: TenantContext): Record<string, unknown> {
  return ctx.allBranches ? {} : { branchId: { $in: ctx.branchIds } };
}

async function loadSupplier(ctx: TenantContext, supplierId: Types.ObjectId) {
  const supplier = await Supplier.findOne({ ...orgFilter(ctx), _id: supplierId }).lean();
  if (!supplier) throw AppError.notFound('Supplier');
  return supplier;
}

export async function supplierSummary(ctx: TenantContext, supplierId: Types.ObjectId) {
  const supplier = await loadSupplier(ctx, supplierId);
  const now = new Date();

  const [owed, lifetime] = await Promise.all([
    PurchaseOrder.aggregate<{
      owed: number;
      overdue: number;
      openCount: number;
      overdueCount: number;
    }>([
      {
        $match: {
          ...orgFilter(ctx),
          ...branchScope(ctx),
          supplierId,
          status: { $in: [...PAYABLE_ORDER_STATUSES] },
        },
      },
      { $addFields: { owing: OWED_EXPRESSION } },
      { $match: { owing: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          owed: { $sum: '$owing' },
          openCount: { $sum: 1 },
          overdue: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, '$owing', 0] } },
          overdueCount: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, 1, 0] } },
        },
      },
    ]),
    PurchaseOrder.aggregate<{ purchases: number; count: number; last: Date }>([
      {
        $match: {
          ...orgFilter(ctx),
          ...branchScope(ctx),
          supplierId,
          status: { $in: [...PAYABLE_ORDER_STATUSES] },
        },
      },
      {
        $group: {
          _id: null,
          purchases: {
            $sum: {
              $subtract: [
                { $ifNull: ['$receivedValuePaise', 0] },
                { $ifNull: ['$returnedPaise', 0] },
              ],
            },
          },
          count: { $sum: 1 },
          last: { $max: '$orderDate' },
        },
      },
    ]),
  ]);

  return {
    supplier,
    owedPaise: owed[0]?.owed ?? 0,
    overduePaise: owed[0]?.overdue ?? 0,
    openOrders: owed[0]?.openCount ?? 0,
    overdueOrders: owed[0]?.overdueCount ?? 0,
    lifetimePurchasesPaise: lifetime[0]?.purchases ?? 0,
    orderCount: lifetime[0]?.count ?? 0,
    lastOrderDate: lifetime[0]?.last ?? null,
  };
}

export async function supplierStatement(
  ctx: TenantContext,
  supplierId: Types.ObjectId,
  range: { from?: Date; to?: Date },
): Promise<{ supplier: { _id: Types.ObjectId; name: string } } & Statement> {
  const supplier = await loadSupplier(ctx, supplierId);
  const to = range.to ? endOfDay(range.to) : new Date();
  const scope = { ...orgFilter(ctx), ...branchScope(ctx) };

  const orders = await PurchaseOrder.find({ ...scope, supplierId })
    .select('number items')
    .limit(5000)
    .lean();
  const orderIds = orders.map((order) => order._id);
  const priceByOrderProduct = new Map(
    orders.flatMap((order) =>
      order.items.map((item) => [`${order._id.toString()}:${item.productId.toString()}`, item.unitPricePaise] as const),
    ),
  );

  const [receipts, payments, returns] = await Promise.all([
    GoodsReceipt.find({ ...scope, purchaseOrderId: { $in: orderIds }, receivedDate: { $lte: to } })
      .select('number purchaseOrderId purchaseOrderNumber receivedDate valuePaise items')
      .limit(5000)
      .lean(),
    SupplierPayment.find({
      ...scope,
      supplierId,
      status: PAYMENT_STATUSES.RECORDED,
      paymentDate: { $lte: to },
    })
      .select('number paymentDate amountPaise method reference')
      .limit(5000)
      .lean(),
    PurchaseReturn.find({ ...scope, supplierId, returnDate: { $lte: to } })
      .select('number returnDate totalPaise purchaseOrderNumber')
      .limit(5000)
      .lean(),
  ]);

  const entries: StatementEntry[] = [
    ...receipts.map((receipt) => {
      // Receipts written before they recorded their own value are priced from the
      // order they were received against.
      const value =
        receipt.valuePaise > 0
          ? receipt.valuePaise
          : sumPaise(
              receipt.items.map((item) =>
                multiplyPaise(
                  priceByOrderProduct.get(`${receipt.purchaseOrderId.toString()}:${item.productId.toString()}`) ?? 0,
                  item.receivedQty,
                ),
              ),
            );
      return {
        date: receipt.receivedDate,
        type: 'RECEIPT',
        reference: receipt.number,
        description: `Goods received against ${receipt.purchaseOrderNumber}`,
        debitPaise: value,
        creditPaise: 0,
        link: { type: 'purchase-order', id: receipt.purchaseOrderId.toString() },
      };
    }),
    ...payments.map((payment) => ({
      date: payment.paymentDate,
      type: 'PAYMENT',
      reference: payment.number,
      description: `Payment made (${payment.method.toLowerCase().replace('_', ' ')})${payment.reference ? ` ref ${payment.reference}` : ''}`,
      debitPaise: 0,
      creditPaise: payment.amountPaise,
      link: { type: 'supplier-payment', id: payment._id.toString() },
    })),
    ...returns.map((purchaseReturn) => ({
      date: purchaseReturn.returnDate,
      type: 'RETURN',
      reference: purchaseReturn.number,
      description: `Goods sent back against ${purchaseReturn.purchaseOrderNumber}`,
      debitPaise: 0,
      creditPaise: purchaseReturn.totalPaise,
      link: { type: 'purchase-return', id: purchaseReturn._id.toString() },
    })),
  ];

  return {
    supplier: { _id: supplier._id, name: supplier.name },
    ...buildStatement(entries, { ...(range.from ? { from: range.from } : {}), to }),
  };
}

/** What is owed to each of these suppliers, for a balance beside every name in a list. */
export async function owedBySupplier(
  ctx: TenantContext,
  supplierIds: Types.ObjectId[],
): Promise<Map<string, number>> {
  if (supplierIds.length === 0) return new Map();

  const rows = await PurchaseOrder.aggregate<{ _id: Types.ObjectId; owing: number }>([
    {
      $match: {
        ...orgFilter(ctx),
        ...branchScope(ctx),
        supplierId: { $in: supplierIds },
        status: { $in: [...PAYABLE_ORDER_STATUSES] },
      },
    },
    { $group: { _id: '$supplierId', owing: { $sum: OWED_EXPRESSION } } },
  ]);

  return new Map(rows.map((row) => [row._id.toString(), row.owing]));
}
