import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Receipt, Search } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission, useAuthStore } from '@/stores/authStore';
import { formatDate, formatMoney } from '@/lib/format';
import { INVOICE_STATUS, statusOf } from '@/lib/statusStyles';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useInvoices } from './invoicesApi';
import { NewInvoiceDialog } from './NewInvoiceDialog';

/**
 * Every invoice, with the question a shop owner actually asks of the list: who has
 * not paid. Overdue and unpaid are one click, and an overdue bill says how late it
 * is right on the row.
 */
export function InvoicesPage() {
  const canCreate = useHasPermission(PERMISSIONS.SALES_CREATE);
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const [status, setStatus] = useState('');
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(term.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isPending, isError, error, refetch } = useInvoices({
    branchId: activeBranchId,
    status: status || undefined,
    q: q || undefined,
    outstandingOnly: unpaidOnly,
    overdue: overdueOnly,
    page,
  });

  const invoices = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="mx-auto max-w-6xl">
      <LabelledPageHeader
        label={{ en: 'Sales', hi: 'बिक्री' }}
        description="Invoices - the record of what was sold, at what rate"
        actions={
          canCreate ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New invoice
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Invoice no. or customer"
            aria-label="Search invoices"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <Select
          className="w-44"
          aria-label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All invoices</option>
          <option value="ISSUED">Unpaid</option>
          <option value="PARTIALLY_PAID">Partly paid</option>
          <option value="PAID">Paid</option>
          <option value="RETURNED">Returned</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={unpaidOnly}
            onChange={(event) => {
              setUnpaidOnly(event.target.checked);
              setPage(1);
            }}
          />
          Money owed
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={overdueOnly}
            onChange={(event) => {
              setOverdueOnly(event.target.checked);
              setPage(1);
            }}
          />
          Overdue only
        </label>
      </div>

      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : 'Could not load invoices'} onRetry={() => void refetch()} />
      ) : !isPending && invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={q || status || unpaidOnly || overdueOnly ? 'No invoices match' : 'No invoices yet'}
          message={q || status || unpaidOnly || overdueOnly ? 'Try a different search or clear a filter.' : 'Create your first invoice to record a sale.'}
          action={
            canCreate && !q && !status ? (
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                New invoice
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Date</TH>
                <TH>Customer</TH>
                <TH>Branch</TH>
                <TH>Due</TH>
                <TH numeric>Total</TH>
                <TH numeric>Owed</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {isPending ? (
                <TableMessage colSpan={8}>Loading invoices...</TableMessage>
              ) : (
                invoices.map((invoice) => {
                  const style = statusOf(INVOICE_STATUS, invoice.status);
                  return (
                    <TR key={invoice._id}>
                      <TD>
                        <Link to={`/sales/${invoice._id}`} className="font-medium tabular hover:text-primary hover:underline">
                          {invoice.number}
                        </Link>
                      </TD>
                      <TD className="text-muted-foreground">{formatDate(invoice.invoiceDate)}</TD>
                      <TD>{invoice.customerName}</TD>
                      <TD>{invoice.branchName}</TD>
                      <TD className="whitespace-nowrap text-muted-foreground">
                        {invoice.dueDate ? formatDate(invoice.dueDate) : '-'}
                        {invoice.overdueDays > 0 && (
                          <span className="ml-1.5 text-xs font-medium text-destructive">
                            {invoice.overdueDays}d late
                          </span>
                        )}
                      </TD>
                      <TD numeric>{formatMoney(invoice.totalPaise)}</TD>
                      <TD numeric>
                        {invoice.outstandingPaise > 0 ? (
                          <span className="font-semibold text-destructive">{formatMoney(invoice.outstandingPaise)}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TD>
                      <TD>
                        <Badge variant={style.variant}>{style.label}</Badge>
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

      <NewInvoiceDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
