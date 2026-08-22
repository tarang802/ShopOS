import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, IndianRupee } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useCancelInvoice, useInvoice } from './invoicesApi';
import { RecordPaymentDialog } from '../payments/RecordPaymentDialog';

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  ISSUED: 'default',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  CANCELLED: 'destructive',
};

/**
 * One invoice, exactly as it was created.
 *
 * Every value on this page - product names, rates, tax, totals - is read
 * straight from the invoice document, never recalculated from today's
 * catalogue. That is the whole point: if the price of this product changes
 * tomorrow, this page still shows what was actually charged.
 */
export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canCancel = useHasPermission(PERMISSIONS.SALES_CANCEL);
  const canRecordPayment = useHasPermission(PERMISSIONS.PAYMENTS_CREATE);

  const { data: invoice, isPending, isError, error, refetch } = useInvoice(id);
  const cancelInvoice = useCancelInvoice();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

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

  const canPay = invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID';
  const canCancelNow = invoice.status !== 'CANCELLED' && invoice.paidPaise === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/sales" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All invoices
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight tabular">{invoice.number}</h1>
            <Badge variant={STATUS_VARIANT[invoice.status]}>{invoice.status.replace('_', ' ')}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {invoice.customerName} - {invoice.branchName} - {formatDateTime(invoice.invoiceDate)}
          </p>
        </div>
        <div className="flex gap-2">
          {canRecordPayment && canPay && (
            <Button onClick={() => setPayOpen(true)}>
              <IndianRupee className="h-4 w-4" aria-hidden />
              Record payment
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

      {invoice.status === 'CANCELLED' && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            This invoice was cancelled{invoice.cancelledAt ? ` on ${formatDateTime(invoice.cancelledAt)}` : ''}.
            {invoice.cancelReason && <> Reason: {invoice.cancelReason}</>} The stock it moved has been returned.
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qty</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rate</th>
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
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {formatNumber(item.quantity)} {item.unitSymbol}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{formatMoney(item.unitPricePaise)}</td>
                  <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{item.taxRatePercent}%</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular">{formatMoney(item.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end border-t border-border p-4">
            <div className="w-64 space-y-1.5 text-sm">
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
              <div className="flex justify-between text-muted-foreground">
                <span>Paid</span>
                <span className="tabular">{formatMoney(invoice.paidPaise)}</span>
              </div>
              {invoice.outstandingPaise > 0 && (
                <div className="flex justify-between font-semibold text-destructive">
                  <span>Outstanding</span>
                  <span className="tabular">{formatMoney(invoice.outstandingPaise)}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">Created by {invoice.createdByName}</p>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoiceId={invoice._id}
        branchId={invoice.branchId}
        {...(invoice.customerId ? { customerId: invoice.customerId } : {})}
        customerName={invoice.customerName}
        outstandingPaise={invoice.outstandingPaise}
      />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this invoice?"
        message="The stock it sold will be returned to the branch. This cannot be undone."
        confirmLabel="Cancel invoice"
        destructive
        busy={cancelInvoice.isPending}
        onConfirm={() => {
          // useCancelInvoice invalidates the ['invoices'] query prefix, which
          // covers this page's ['invoices','detail',id] query too - no manual
          // refetch or navigation needed, the detail below updates itself.
          cancelInvoice.mutate({ id: invoice._id }, { onSuccess: () => setCancelOpen(false) });
        }}
      />
    </div>
  );
}
