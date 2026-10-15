import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Check, Printer, Receipt } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { ApiRequestError } from '@/lib/apiClient';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { INVOICE_STATUS, SALES_ORDER_STATUS, statusOf } from '@/lib/statusStyles';
import { PrintFooter, PrintHeader } from '@/components/PrintHeader';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { DocumentLinesTable } from './DocumentLinesTable';
import { InvoiceOrderDialog } from './InvoiceOrderDialog';
import { useCancelSalesOrder, useConfirmSalesOrder, useSalesOrder } from './salesOrdersApi';

/** One sales order: what was promised, what has been billed, and the invoices so far. */
export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canUpdate = useHasPermission(PERMISSIONS.SALES_UPDATE);
  const canCreate = useHasPermission(PERMISSIONS.SALES_CREATE);
  const canCancel = useHasPermission(PERMISSIONS.SALES_CANCEL);

  const { data: order, isPending, isError, error, refetch } = useSalesOrder(id);
  const confirm = useConfirmSalesOrder();
  const cancel = useCancelSalesOrder();

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : 'Could not load this order'} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (isPending || !order) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const style = statusOf(SALES_ORDER_STATUS, order.status);
  const anyBilled = order.items.some((line) => (line.invoicedQty ?? 0) > 0);
  const canBill = order.status === 'CONFIRMED' || order.status === 'PARTIALLY_INVOICED';

  return (
    <div className="mx-auto max-w-3xl">
      <PrintHeader title="Sales order" />

      <Link to="/sales-orders" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All sales orders
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-xl font-semibold tabular">{order.number}</h1>
            <Badge variant={style.variant}>{style.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.customerName} - {order.branchName} - {formatDateTime(order.orderDate)}
          </p>
          {order.expectedDate && <p className="mt-0.5 text-sm text-muted-foreground">Wanted by {formatDate(order.expectedDate)}</p>}
          {order.quotationNumber && <p className="mt-0.5 text-sm text-muted-foreground">From quotation {order.quotationNumber}</p>}
        </div>

        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </Button>
          {canUpdate && order.status === 'DRAFT' && (
            <Button
              onClick={() =>
                confirm.mutate(order._id, {
                  onError: (cause) => setActionError(cause instanceof ApiRequestError ? cause.message : 'Could not confirm'),
                })
              }
              disabled={confirm.isPending}
            >
              <Check className="h-4 w-4" aria-hidden />
              Confirm order
            </Button>
          )}
          {canCreate && canBill && (
            <Button onClick={() => setInvoiceOpen(true)}>
              <Receipt className="h-4 w-4" aria-hidden />
              Invoice
            </Button>
          )}
          {canCancel && !anyBilled && (order.status === 'DRAFT' || order.status === 'CONFIRMED') && (
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              <Ban className="h-4 w-4" aria-hidden />
              Cancel order
            </Button>
          )}
        </div>
      </div>

      {actionError && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">{actionError}</p>}

      {order.status === 'CANCELLED' && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            This order was cancelled.{order.cancelReason && <> Reason: {order.cancelReason}.</>}
          </CardContent>
        </Card>
      )}

      <DocumentLinesTable items={order.items} totals={order} showInvoiced={order.status !== 'DRAFT'} />

      {order.invoices.length > 0 && (
        <Card className="mb-6 print:hidden">
          <CardContent className="p-4">
            <h2 className="mb-3 font-serif text-sm font-semibold">Invoices raised from this order</h2>
            <ul className="divide-y divide-border">
              {order.invoices.map((invoice) => {
                const invoiceStyle = statusOf(INVOICE_STATUS, invoice.status);
                return (
                  <li key={invoice._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <Link to={`/sales/${invoice._id}`} className="font-medium tabular hover:text-primary hover:underline">
                      {invoice.number}
                    </Link>
                    <span className="text-muted-foreground">{formatDate(invoice.invoiceDate)}</span>
                    <span className="flex items-center gap-3">
                      <Badge variant={invoiceStyle.variant}>{invoiceStyle.label}</Badge>
                      <span className="tabular font-medium">{formatMoney(invoice.totalPaise)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {order.notes && <p className="mb-2 text-sm text-muted-foreground">Notes: {order.notes}</p>}
      <p className="text-xs text-muted-foreground print:hidden">Created by {order.createdByName}</p>
      <PrintFooter />

      <InvoiceOrderDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} orderId={order._id} items={order.items} />

      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this sales order?"
        message="Nothing has been billed, so no stock or money is affected. The order is closed."
        confirmLabel="Cancel order"
        busy={cancel.isPending}
        error={actionError}
        onConfirm={(reason) => {
          setActionError(null);
          cancel.mutate(
            { id: order._id, ...(reason ? { reason } : {}) },
            {
              onSuccess: () => setCancelOpen(false),
              onError: (cause) => setActionError(cause instanceof ApiRequestError ? cause.message : 'Could not cancel'),
            },
          );
        }}
      />
    </div>
  );
}
