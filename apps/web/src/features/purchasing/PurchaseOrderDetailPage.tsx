import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, IndianRupee, PackageCheck, Printer, Send, Undo2 } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { ApiRequestError } from '@/lib/apiClient';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { PAYABLE_STATUS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS, PURCHASE_STATUS, RETURN_REASON_LABELS, statusOf } from '@/lib/statusStyles';
import { PrintFooter, PrintHeader } from '@/components/PrintHeader';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, Skeleton } from '@/components/ui/states';
import {
  useCancelPurchaseOrder,
  usePurchaseOrder,
  useSendPurchaseOrder,
  useVoidSupplierPayment,
} from './purchasingApi';
import { PurchaseReturnDialog } from './PurchaseReturnDialog';
import { SupplierPaymentDialog } from './SupplierPaymentDialog';
import { ReceiveGoodsDialog } from './ReceiveGoodsDialog';

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canUpdate = useHasPermission(PERMISSIONS.PURCHASES_UPDATE);
  const canReceive = useHasPermission(PERMISSIONS.PURCHASES_RECEIVE);
  const canPay = useHasPermission(PERMISSIONS.PURCHASES_PAY);
  const canReturn = useHasPermission(PERMISSIONS.PURCHASES_RETURN);

  const { data: po, isPending, isError, error, refetch } = usePurchaseOrder(id);
  const sendPO = useSendPurchaseOrder();
  const cancelPO = useCancelPurchaseOrder();
  const voidPayment = useVoidSupplierPayment();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : 'Could not load this purchase order'} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (isPending || !po) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const canSend = canUpdate && po.status === 'DRAFT';
  const canReceiveNow = canReceive && (po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED');
  const canCancelNow =
    canUpdate &&
    po.status !== 'CANCELLED' &&
    po.status !== 'RECEIVED' &&
    po.items.every((item) => item.receivedQty === 0) &&
    (po.paidPaise ?? 0) === 0;
  const canPayNow = canPay && po.payableCapPaise > 0 && po.status !== 'DRAFT' && po.status !== 'CANCELLED';
  const canReturnNow = canReturn && po.items.some((item) => item.receivedQty - (item.returnedQty ?? 0) > 0);
  const orderStyle = statusOf(PURCHASE_STATUS, po.status);
  const payableStyle = statusOf(PAYABLE_STATUS, po.payableStatus);

  return (
    <div className="mx-auto max-w-3xl">
      <PrintHeader title="Purchase order" />

      <Link to="/purchases" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All purchase orders
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-xl font-semibold tabular">{po.number}</h1>
            <Badge variant={orderStyle.variant}>{orderStyle.label}</Badge>
            {po.status !== 'DRAFT' && po.status !== 'CANCELLED' && <Badge variant={payableStyle.variant}>{payableStyle.label}</Badge>}
            {po.overdueDays > 0 && <Badge variant="destructive">{po.overdueDays} days overdue</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link to={`/suppliers/${po.supplierId}`} className="hover:text-primary hover:underline">{po.supplierName}</Link> - {po.branchName} - {formatDateTime(po.orderDate)}
          </p>
          {po.dueDate && po.owedPaise > 0 && <p className="mt-0.5 text-sm text-muted-foreground">Payment due {formatDate(po.dueDate)}</p>}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </Button>
          {canPayNow && (
            <Button onClick={() => setPayOpen(true)}>
              <IndianRupee className="h-4 w-4" aria-hidden />
              Pay
            </Button>
          )}
          {canReturnNow && (
            <Button variant="outline" onClick={() => setReturnOpen(true)}>
              <Undo2 className="h-4 w-4" aria-hidden />
              Return to supplier
            </Button>
          )}
          {canSend && (
            <Button onClick={() => sendPO.mutate(po._id)} disabled={sendPO.isPending}>
              <Send className="h-4 w-4" aria-hidden />
              {sendPO.isPending ? 'Sending...' : 'Send to supplier'}
            </Button>
          )}
          {canReceiveNow && (
            <Button onClick={() => setReceiveOpen(true)}>
              <PackageCheck className="h-4 w-4" aria-hidden />
              Receive goods
            </Button>
          )}
          {canCancelNow && (
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              <Ban className="h-4 w-4" aria-hidden />
              Cancel order
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ordered</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Received</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rate</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line total</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((item, index) => (
                <tr key={index} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">{item.productName}</span>
                    <span className="text-xs text-muted-foreground tabular">{item.sku}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {formatNumber(item.orderedQty)} {item.unitSymbol}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {item.receivedQty === item.orderedQty ? (
                      <span className="text-success">{formatNumber(item.receivedQty)}</span>
                    ) : (
                      formatNumber(item.receivedQty)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{formatMoney(item.unitPricePaise)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular">{formatMoney(item.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end border-t border-border p-4">
            <div className="w-56 space-y-1.5 text-sm">
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                <span>Total</span>
                <span className="tabular">{formatMoney(po.totalPaise)}</span>
              </div>
              {(po.receivedValuePaise ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Received so far</span>
                  <span className="tabular">{formatMoney(po.receivedValuePaise ?? 0)}</span>
                </div>
              )}
              {(po.returnedPaise ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Sent back</span>
                  <span className="tabular">- {formatMoney(po.returnedPaise ?? 0)}</span>
                </div>
              )}
              {(po.paidPaise ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Paid</span>
                  <span className="tabular">{formatMoney(po.paidPaise ?? 0)}</span>
                </div>
              )}
              {po.owedPaise > 0 && (
                <div className="flex justify-between font-semibold text-destructive">
                  <span>You owe</span>
                  <span className="tabular">{formatMoney(po.owedPaise)}</span>
                </div>
              )}
              {po.creditDuePaise > 0 && (
                <div className="flex justify-between font-semibold text-success">
                  <span>Supplier owes you</span>
                  <span className="tabular">{formatMoney(po.creditDuePaise)}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {po.payments.length > 0 && (
        <Card className="mb-6 print:hidden">
          <CardContent className="p-4">
            <h2 className="mb-3 font-serif text-sm font-semibold">Payments</h2>
            <ul className="divide-y divide-border">
              {po.payments.map((payment) => {
                const paymentStyle = statusOf(PAYMENT_STATUS, payment.status);
                return (
                  <li key={payment._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div>
                      <span className="font-medium tabular">{payment.number}</span>
                      <span className="ml-2 text-muted-foreground">
                        {formatDate(payment.paymentDate)} - {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                        {payment.reference ? ` - ${payment.reference}` : ''}
                      </span>
                      {payment.status === 'VOIDED' && payment.voidReason && (
                        <span className="block text-xs text-muted-foreground">Voided: {payment.voidReason}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={paymentStyle.variant}>{paymentStyle.label}</Badge>
                      <span className={payment.status === 'VOIDED' ? 'tabular text-muted-foreground line-through' : 'tabular font-medium'}>
                        {formatMoney(payment.amountPaise)}
                      </span>
                      {canPay && payment.status === 'RECORDED' && (
                        <Button variant="ghost" size="sm" onClick={() => setVoiding(payment._id)}>
                          Void
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {po.returns.length > 0 && (
        <Card className="mb-6 print:hidden">
          <CardContent className="p-4">
            <h2 className="mb-3 font-serif text-sm font-semibold">Goods sent back</h2>
            <ul className="divide-y divide-border">
              {po.returns.map((purchaseReturn) => (
                <li key={purchaseReturn._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <span className="font-medium tabular">{purchaseReturn.number}</span>
                    <span className="ml-2 text-muted-foreground">
                      {formatDate(purchaseReturn.returnDate)} - {RETURN_REASON_LABELS[purchaseReturn.reason] ?? purchaseReturn.reason}
                    </span>
                  </div>
                  <span className="tabular font-medium">{formatMoney(purchaseReturn.totalPaise)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {po.receipts.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Goods receipts</h2>
            <ul className="space-y-3">
              {po.receipts.map((receipt) => (
                <li key={receipt._id} className="text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium tabular">{receipt.number}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(receipt.receivedDate)} - {receipt.receivedByName}
                    </span>
                  </div>
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {receipt.items.map((item, index) => (
                      <li key={index}>
                        {item.productName}: {formatNumber(item.receivedQty)} {item.unitSymbol}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">Created by {po.createdByName}</p>

      <PrintFooter />

      <ReceiveGoodsDialog open={receiveOpen} onOpenChange={setReceiveOpen} purchaseOrder={po} />
      <SupplierPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        supplierId={po.supplierId}
        supplierName={po.supplierName}
        onlyOrderId={po._id}
      />
      <PurchaseReturnDialog open={returnOpen} onOpenChange={setReturnOpen} purchaseOrder={po} />

      <ReasonDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Void this payment?"
        message="The amount comes off what has been paid on this order. The payment stays on record, marked void."
        confirmLabel="Void payment"
        busy={voidPayment.isPending}
        error={actionError}
        onConfirm={(reason) => {
          if (!voiding) return;
          setActionError(null);
          voidPayment.mutate(
            { id: voiding, ...(reason ? { reason } : {}) },
            {
              onSuccess: () => setVoiding(null),
              onError: (cause) =>
                setActionError(cause instanceof ApiRequestError ? cause.message : 'Could not void the payment'),
            },
          );
        }}
      />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this purchase order?"
        message="This cannot be undone."
        confirmLabel="Cancel order"
        destructive
        busy={cancelPO.isPending}
        onConfirm={() => {
          cancelPO.mutate(po._id, { onSuccess: () => setCancelOpen(false) });
        }}
      />
    </div>
  );
}
