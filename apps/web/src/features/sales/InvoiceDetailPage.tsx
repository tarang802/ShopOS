import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Banknote, IndianRupee, Printer, Undo2 } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { ApiRequestError } from '@/lib/apiClient';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { INVOICE_STATUS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS, RETURN_REASON_LABELS, statusOf } from '@/lib/statusStyles';
import { PrintFooter, PrintHeader } from '@/components/PrintHeader';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useCancelInvoice, useInvoice } from './invoicesApi';
import { RecordPaymentDialog } from '../payments/RecordPaymentDialog';
import { useVoidPayment } from '../payments/paymentsApi';
import { RefundDialog } from './RefundDialog';
import { ReturnGoodsDialog } from './ReturnGoodsDialog';

/**
 * One invoice, exactly as it was created.
 *
 * Every value on this page - product names, rates, discount, tax, totals - is read
 * straight from the invoice document, never recalculated from today's catalogue.
 * If the price of this product changes tomorrow, this page still shows what was
 * actually charged. Balances come from the server, which derives them from the
 * payments and returns behind them.
 */
export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canCancel = useHasPermission(PERMISSIONS.SALES_CANCEL);
  const canRecordPayment = useHasPermission(PERMISSIONS.PAYMENTS_CREATE);
  const canVoid = useHasPermission(PERMISSIONS.PAYMENTS_VOID);
  const canReturn = useHasPermission(PERMISSIONS.SALES_RETURN);

  const { data: invoice, isPending, isError, error, refetch } = useInvoice(id);
  const cancelInvoice = useCancelInvoice();
  const voidPayment = useVoidPayment();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : 'Could not load this invoice'} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (isPending || !invoice) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const style = statusOf(INVOICE_STATUS, invoice.status);
  const hasDiscount = invoice.items.some((item) => (item.discountPaise ?? 0) > 0);
  const canPay = invoice.outstandingPaise > 0 && invoice.status !== 'CANCELLED';
  const canCancelNow =
    invoice.status !== 'CANCELLED' && invoice.paidPaise === 0 && (invoice.returnedPaise ?? 0) === 0;
  const canReturnNow =
    invoice.status !== 'CANCELLED' && invoice.items.some((line) => line.quantity - (line.returnedQty ?? 0) > 0);
  const lastReturn = invoice.returns[invoice.returns.length - 1];

  return (
    <div className="mx-auto max-w-3xl">
      <PrintHeader title="Invoice" />

      <Link to="/sales" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All invoices
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight tabular">{invoice.number}</h1>
            <Badge variant={style.variant}>{style.label}</Badge>
            {invoice.overdueDays > 0 && <Badge variant="destructive">{invoice.overdueDays} days overdue</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {invoice.customerName} - {invoice.branchName} - {formatDateTime(invoice.invoiceDate)}
          </p>
          {invoice.dueDate && invoice.outstandingPaise > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground">Payment due {formatDate(invoice.dueDate)}</p>
          )}
          {invoice.salesOrderNumber && (
            <p className="mt-0.5 text-sm text-muted-foreground">Billed from order {invoice.salesOrderNumber}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </Button>
          {canRecordPayment && canPay && (
            <Button onClick={() => setPayOpen(true)}>
              <IndianRupee className="h-4 w-4" aria-hidden />
              Record payment
            </Button>
          )}
          {canReturn && canReturnNow && (
            <Button variant="outline" onClick={() => setReturnOpen(true)}>
              <Undo2 className="h-4 w-4" aria-hidden />
              Return goods
            </Button>
          )}
          {canReturn && invoice.refundDuePaise > 0 && lastReturn && (
            <Button variant="outline" onClick={() => setRefundOpen(true)}>
              <Banknote className="h-4 w-4" aria-hidden />
              Refund customer
            </Button>
          )}
          {canCancel && canCancelNow && (
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              <Ban className="h-4 w-4" aria-hidden />
              Cancel invoice
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">{actionError}</p>
      )}

      {invoice.status === 'CANCELLED' && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            This invoice was cancelled{invoice.cancelledAt ? ` on ${formatDateTime(invoice.cancelledAt)}` : ''}.
            {invoice.cancelReason && <> Reason: {invoice.cancelReason}.</>} The stock it moved has been returned.
          </CardContent>
        </Card>
      )}

      {invoice.refundDuePaise > 0 && (
        <Card className="mb-6 border-warning/50 bg-warning/10">
          <CardContent className="p-4 text-sm">
            {invoice.customerName} has paid {formatMoney(invoice.refundDuePaise)} more than the reduced bill and is owed that back.
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 print:bg-transparent">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qty</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rate</th>
                {hasDiscount && (
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Discount</th>
                )}
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, index) => (
                <tr key={index} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">{item.productName}</span>
                    <span className="text-xs text-muted-foreground tabular">{item.sku}</span>
                    {(item.returnedQty ?? 0) > 0 && (
                      <span className="block text-xs text-warning-foreground">
                        {formatNumber(item.returnedQty ?? 0)} {item.unitSymbol} returned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {formatNumber(item.quantity)} {item.unitSymbol}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{formatMoney(item.unitPricePaise)}</td>
                  {hasDiscount && (
                    <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                      {(item.discountPercent ?? 0) > 0 ? `${item.discountPercent}%` : '-'}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{item.taxRatePercent}%</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular">{formatMoney(item.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end border-t border-border p-4">
            <div className="w-72 space-y-1.5 text-sm">
              {(invoice.discountPaise ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Discount given</span>
                  <span className="tabular">{formatMoney(invoice.discountPaise ?? 0)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular">{formatMoney(invoice.subtotalPaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span className="tabular">{formatMoney(invoice.taxPaise)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                <span>Total</span>
                <span className="tabular">{formatMoney(invoice.totalPaise)}</span>
              </div>
              {(invoice.returnedPaise ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Goods returned</span>
                  <span className="tabular">- {formatMoney(invoice.returnedPaise ?? 0)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Paid</span>
                <span className="tabular">{formatMoney(invoice.paidPaise)}</span>
              </div>
              {(invoice.refundedPaise ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Refunded</span>
                  <span className="tabular">- {formatMoney(invoice.refundedPaise ?? 0)}</span>
                </div>
              )}
              {invoice.outstandingPaise > 0 && (
                <div className="flex justify-between font-semibold text-destructive">
                  <span>Amount due</span>
                  <span className="tabular">{formatMoney(invoice.outstandingPaise)}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {invoice.payments.length > 0 && (
        <Card className="mb-6 print:hidden">
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Payments</h2>
            <ul className="divide-y divide-border">
              {invoice.payments.map((payment) => {
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
                      <span className={payment.status === 'VOIDED' ? 'tabular line-through text-muted-foreground' : 'tabular font-medium'}>
                        {formatMoney(payment.amountPaise)}
                      </span>
                      {canVoid && payment.status === 'RECORDED' && (
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

      {invoice.returns.length > 0 && (
        <Card className="mb-6 print:hidden">
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Goods returned</h2>
            <ul className="divide-y divide-border">
              {invoice.returns.map((salesReturn) => (
                <li key={salesReturn._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <span className="font-medium tabular">{salesReturn.number}</span>
                    <span className="ml-2 text-muted-foreground">
                      {formatDate(salesReturn.returnDate)} - {RETURN_REASON_LABELS[salesReturn.reason] ?? salesReturn.reason}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="tabular font-medium">{formatMoney(salesReturn.creditPaise)} credited</span>
                    {salesReturn.refundedPaise > 0 && (
                      <span className="block text-xs text-muted-foreground">{formatMoney(salesReturn.refundedPaise)} refunded</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {invoice.notes && <p className="mb-4 text-sm text-muted-foreground">Notes: {invoice.notes}</p>}
      <p className="text-xs text-muted-foreground print:hidden">Created by {invoice.createdByName}</p>

      <PrintFooter />

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoiceId={invoice._id}
        branchId={invoice.branchId}
        {...(invoice.customerId ? { customerId: invoice.customerId } : {})}
        customerName={invoice.customerName}
        outstandingPaise={invoice.outstandingPaise}
      />

      {canReturn && <ReturnGoodsDialog open={returnOpen} onOpenChange={setReturnOpen} invoice={invoice} />}
      {lastReturn && (
        <RefundDialog
          open={refundOpen}
          onOpenChange={setRefundOpen}
          returnId={lastReturn._id}
          customerName={invoice.customerName}
          refundDuePaise={invoice.refundDuePaise}
        />
      )}

      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this invoice?"
        message="The stock it sold will be returned to the branch. This cannot be undone."
        confirmLabel="Cancel invoice"
        busy={cancelInvoice.isPending}
        error={actionError}
        onConfirm={(reason) => {
          setActionError(null);
          cancelInvoice.mutate(
            { id: invoice._id, ...(reason ? { reason } : {}) },
            {
              onSuccess: () => setCancelOpen(false),
              onError: (cause) =>
                setActionError(cause instanceof ApiRequestError ? cause.message : 'Could not cancel the invoice'),
            },
          );
        }}
      />

      <ReasonDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title="Void this payment?"
        message="The amount comes off this invoice and it becomes payable again. The payment stays on record, marked void."
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
    </div>
  );
}
