import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, Check, ClipboardList, Printer, Receipt, Send, X } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { ApiRequestError } from '@/lib/apiClient';
import { formatDate, formatDateTime } from '@/lib/format';
import { QUOTATION_STATUS, statusOf } from '@/lib/statusStyles';
import { PrintFooter, PrintHeader } from '@/components/PrintHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { DocumentLinesTable } from './DocumentLinesTable';
import {
  useConvertQuotationToInvoice,
  useConvertQuotationToOrder,
  useExtendQuotation,
  useQuotation,
  useQuotationAction,
} from './quotationsApi';

/**
 * One quotation, with the next step for each stage of its life.
 *
 * The buttons offered follow the status: a draft can be sent, a sent offer accepted
 * or rejected, and anything still standing can be turned into an order or billed at
 * once. Prices are those frozen when it was written.
 */
export function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canUpdate = useHasPermission(PERMISSIONS.SALES_UPDATE);
  const canCreate = useHasPermission(PERMISSIONS.SALES_CREATE);

  const { data: quotation, isPending, isError, error, refetch } = useQuotation(id);
  const action = useQuotationAction();
  const extend = useExtendQuotation();
  const toOrder = useConvertQuotationToOrder();
  const toInvoice = useConvertQuotationToInvoice();

  const [confirm, setConfirm] = useState<'reject' | 'invoice' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : 'Could not load this quotation'} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (isPending || !quotation) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const style = statusOf(QUOTATION_STATUS, quotation.status);
  const expired = quotation.status === 'EXPIRED';
  const live = ['DRAFT', 'SENT', 'ACCEPTED'].includes(quotation.status);

  function fail(cause: unknown, fallback: string) {
    setActionError(cause instanceof ApiRequestError ? cause.message : fallback);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PrintHeader title="Quotation" />

      <Link to="/quotations" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All quotations
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-xl font-semibold tabular">{quotation.number}</h1>
            <Badge variant={style.variant}>{style.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {quotation.customerName} - {quotation.branchName} - {formatDateTime(quotation.quotationDate)}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {expired ? 'Lapsed on' : 'Valid until'} {formatDate(quotation.validUntil)}
          </p>
          {quotation.convertedTo && (
            <p className="mt-0.5 text-sm">
              Turned into{' '}
              <Link
                to={quotation.convertedTo.type === 'INVOICE' ? `/sales/${quotation.convertedTo.id}` : `/sales-orders/${quotation.convertedTo.id}`}
                className="font-medium tabular text-primary hover:underline"
              >
                {quotation.convertedTo.number}
              </Link>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </Button>
          {canUpdate && quotation.status === 'DRAFT' && !expired && (
            <Button onClick={() => action.mutate({ id: quotation._id, action: 'send' }, { onError: (c) => fail(c, 'Could not send') })}>
              <Send className="h-4 w-4" aria-hidden />
              Mark as sent
            </Button>
          )}
          {canUpdate && ['DRAFT', 'SENT'].includes(quotation.status) && !expired && (
            <Button
              variant="outline"
              onClick={() => action.mutate({ id: quotation._id, action: 'accept' }, { onError: (c) => fail(c, 'Could not accept') })}
            >
              <Check className="h-4 w-4" aria-hidden />
              Customer accepted
            </Button>
          )}
          {canUpdate && (expired || ['DRAFT', 'SENT'].includes(quotation.status)) && (
            <Button
              variant="outline"
              onClick={() => extend.mutate({ id: quotation._id, days: 15 }, { onError: (c) => fail(c, 'Could not extend') })}
            >
              <CalendarPlus className="h-4 w-4" aria-hidden />
              Extend 15 days
            </Button>
          )}
          {canCreate && live && !expired && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  toOrder.mutate(quotation._id, {
                    onSuccess: (order) => navigate(`/sales-orders/${order._id}`),
                    onError: (c) => fail(c, 'Could not create the order'),
                  })
                }
                disabled={toOrder.isPending}
              >
                <ClipboardList className="h-4 w-4" aria-hidden />
                Make a sales order
              </Button>
              <Button onClick={() => setConfirm('invoice')}>
                <Receipt className="h-4 w-4" aria-hidden />
                Bill now
              </Button>
            </>
          )}
          {canUpdate && (live || expired) && quotation.status !== 'CONVERTED' && (
            <Button variant="ghost" onClick={() => setConfirm('reject')}>
              <X className="h-4 w-4" aria-hidden />
              Reject
            </Button>
          )}
        </div>
      </div>

      {actionError && <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">{actionError}</p>}

      <DocumentLinesTable items={quotation.items} totals={quotation} />

      {quotation.notes && <p className="mb-2 text-sm text-muted-foreground">Notes: {quotation.notes}</p>}
      {quotation.terms && <p className="mb-2 text-sm text-muted-foreground">Terms: {quotation.terms}</p>}
      <p className="text-xs text-muted-foreground print:hidden">Created by {quotation.createdByName}</p>

      <PrintFooter />

      <ConfirmDialog
        open={confirm === 'reject'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Reject this quotation?"
        message="It will be closed and can no longer be turned into an order or an invoice."
        confirmLabel="Reject"
        destructive
        busy={action.isPending}
        onConfirm={() =>
          action.mutate(
            { id: quotation._id, action: 'reject' },
            { onSuccess: () => setConfirm(null), onError: (c) => fail(c, 'Could not reject') },
          )
        }
      />

      <ConfirmDialog
        open={confirm === 'invoice'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Bill this quotation now?"
        message="An invoice is created at exactly the quoted prices and the stock is taken from the shelf. You can record payment on the invoice afterwards."
        confirmLabel="Create invoice"
        busy={toInvoice.isPending}
        onConfirm={() =>
          toInvoice.mutate(
            { id: quotation._id },
            {
              onSuccess: (invoice) => navigate(`/sales/${invoice._id}`),
              onError: (c) => {
                setConfirm(null);
                fail(c, 'Could not create the invoice');
              },
            },
          )
        }
      />
    </div>
  );
}
