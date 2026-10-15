import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Search } from 'lucide-react';
import { PAYMENT_METHODS, PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { ApiRequestError } from '@/lib/apiClient';
import { formatDate, formatMoney } from '@/lib/format';
import { LABELS } from '@/lib/labels';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS, statusOf } from '@/lib/statusStyles';
import { LabelledPageHeader } from '@/components/PageHeader';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { usePayments, useVoidPayment } from './paymentsApi';

/**
 * Money received, across every customer.
 *
 * A payment is never deleted - voiding one marks it and re-opens the bills it
 * settled, so a bounced cheque or a payment keyed against the wrong bill is
 * corrected on the record rather than hidden.
 */
export function PaymentsPage() {
  const canVoid = useHasPermission(PERMISSIONS.PAYMENTS_VOID);
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(term.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isPending, isError, error: loadError, refetch } = usePayments({
    q: q || undefined,
    status: status || undefined,
    method: method || undefined,
    page,
  });
  const voidPayment = useVoidPayment();

  const payments = data?.items ?? [];
  const pagination = data?.pagination;
  const filtered = Boolean(q || status || method);

  return (
    <div className="mx-auto max-w-6xl">
      <LabelledPageHeader label={LABELS.payments} description="Money received from customers" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Receipt no., customer or reference"
            aria-label="Search payments"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <Select className="w-40" aria-label="Method" value={method} onChange={(event) => { setMethod(event.target.value); setPage(1); }}>
          <option value="">Any method</option>
          {Object.values(PAYMENT_METHODS).map((value) => (
            <option key={value} value={value}>
              {PAYMENT_METHOD_LABELS[value] ?? value}
            </option>
          ))}
        </Select>
        <Select className="w-40" aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">All payments</option>
          <option value="RECORDED">Recorded</option>
          <option value="VOIDED">Voided</option>
        </Select>
      </div>

      {isError ? (
        <ErrorState message={loadError instanceof Error ? loadError.message : 'Could not load payments'} onRetry={() => void refetch()} />
      ) : !isPending && payments.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title={filtered ? 'No payments match' : 'No payments yet'}
          message={filtered ? 'Try a different search or clear a filter.' : 'Payments appear here as they are recorded against invoices.'}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Receipt</TH>
                <TH>Date</TH>
                <TH>Customer</TH>
                <TH>Method</TH>
                <TH>Applied to</TH>
                <TH numeric>Amount</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {isPending ? (
                <TableMessage colSpan={8}>Loading payments...</TableMessage>
              ) : (
                payments.map((payment) => {
                  const style = statusOf(PAYMENT_STATUS, payment.status);
                  const voided = payment.status === 'VOIDED';
                  return (
                    <TR key={payment._id}>
                      <TD className="font-medium tabular">{payment.number}</TD>
                      <TD className="text-muted-foreground">{formatDate(payment.paymentDate)}</TD>
                      <TD>{payment.customerName}</TD>
                      <TD>
                        {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                        {payment.reference && <span className="block text-xs text-muted-foreground">{payment.reference}</span>}
                      </TD>
                      <TD className="text-sm">
                        {payment.allocations.map((allocation, index) => (
                          <span key={allocation.invoiceId}>
                            {index > 0 && ', '}
                            <Link to={`/sales/${allocation.invoiceId}`} className="tabular hover:text-primary hover:underline">
                              {allocation.invoiceNumber}
                            </Link>
                          </span>
                        ))}
                      </TD>
                      <TD numeric className={voided ? 'text-muted-foreground line-through' : ''}>
                        {formatMoney(payment.amountPaise)}
                      </TD>
                      <TD>
                        <Badge variant={style.variant}>{style.label}</Badge>
                        {voided && payment.voidReason && (
                          <span className="block text-xs text-muted-foreground">{payment.voidReason}</span>
                        )}
                      </TD>
                      <TD>
                        {canVoid && !voided && (
                          <Button variant="ghost" size="sm" onClick={() => setVoiding(payment._id)}>
                            Void
                          </Button>
                        )}
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ReasonDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVoiding(null);
            setError(null);
          }
        }}
        title="Void this payment?"
        message="The amount comes off the invoices it settled and they become payable again. The payment stays on record, marked void."
        confirmLabel="Void payment"
        busy={voidPayment.isPending}
        error={error}
        onConfirm={(reason) => {
          if (!voiding) return;
          setError(null);
          voidPayment.mutate(
            { id: voiding, ...(reason ? { reason } : {}) },
            {
              onSuccess: () => setVoiding(null),
              onError: (cause) => setError(cause instanceof ApiRequestError ? cause.message : 'Could not void the payment'),
            },
          );
        }}
      />
    </div>
  );
}
