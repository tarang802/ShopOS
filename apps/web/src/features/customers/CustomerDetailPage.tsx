import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Printer } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { formatDate, formatMoney } from '@/lib/format';
import { INVOICE_STATUS, statusOf } from '@/lib/statusStyles';
import { PrintHeader } from '@/components/PrintHeader';
import { StatementTable } from '@/components/StatementTable';
import { StatTile } from '@/components/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useInvoices } from '../sales/invoicesApi';
import { CustomerFormDialog } from './CustomerFormDialog';
import { useCustomerStatement, useCustomerSummary } from './customersApi';

/**
 * One customer's account: what they owe, how late it is, how much credit is left,
 * the bills still open, and the full statement of every bill, payment, return and
 * refund. The statement and the balance are built from the same documents, so they
 * cannot disagree.
 */
export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canManage = useHasPermission(PERMISSIONS.CUSTOMERS_MANAGE);
  const [editOpen, setEditOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: summary, isPending, isError, error, refetch } = useCustomerSummary(id);
  const { data: statement } = useCustomerStatement(id, {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const { data: open } = useInvoices({ customerId: id, outstandingOnly: true });

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState message={error instanceof Error ? error.message : 'Could not load this customer'} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (isPending || !summary) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const { customer } = summary;
  const openInvoices = open?.items ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PrintHeader title="Statement of account" />

      <Link to="/customers" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All customers
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b-[3px] border-double border-brass/70 pb-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-primary">{customer.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[customer.phone, customer.city, customer.gstin && `GSTIN ${customer.gstin}`].filter(Boolean).join('  -  ') || 'No contact details'}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {customer.creditDays ? `${customer.creditDays} days to pay` : 'Pays on the spot'}
            {customer.creditLimitPaise ? ` - limit ${formatMoney(customer.creditLimitPaise)}` : ''}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden />
            Print statement
          </Button>
          {canManage && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Owes"
          value={formatMoney(summary.outstandingPaise)}
          hint={`${summary.openInvoices} open invoice${summary.openInvoices === 1 ? '' : 's'}`}
          {...(summary.outstandingPaise > 0 ? { tone: 'warning' as const } : {})}
        />
        <StatTile
          label="Overdue"
          value={formatMoney(summary.overduePaise)}
          hint={`${summary.overdueInvoices} past due`}
          {...(summary.overduePaise > 0 ? { tone: 'danger' as const } : {})}
        />
        {summary.refundDuePaise > 0 ? (
          <StatTile label="Owed back to them" value={formatMoney(summary.refundDuePaise)} hint="Paid beyond their reduced bills" tone="good" />
        ) : (
          <StatTile
            label="Credit left"
            value={summary.creditAvailablePaise === null ? 'No limit' : formatMoney(summary.creditAvailablePaise)}
            hint={summary.creditLimitPaise ? `of ${formatMoney(summary.creditLimitPaise)}` : undefined}
          />
        )}
        <StatTile
          label="Bought, lifetime"
          value={formatMoney(summary.lifetimeSalesPaise)}
          hint={summary.lastInvoiceDate ? `last on ${formatDate(summary.lastInvoiceDate)}` : 'no purchases yet'}
        />
      </div>

      {openInvoices.length > 0 && (
        <section className="mb-6 print:hidden">
          <h2 className="mb-2 font-serif text-base font-semibold">Open invoices</h2>
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
                <TH>Date</TH>
                <TH>Due</TH>
                <TH numeric>Total</TH>
                <TH numeric>Owed</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {openInvoices.map((invoice) => {
                const style = statusOf(INVOICE_STATUS, invoice.status);
                return (
                  <TR key={invoice._id}>
                    <TD>
                      <Link to={`/sales/${invoice._id}`} className="font-medium tabular hover:text-primary hover:underline">
                        {invoice.number}
                      </Link>
                    </TD>
                    <TD className="text-muted-foreground">{formatDate(invoice.invoiceDate)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {invoice.dueDate ? formatDate(invoice.dueDate) : '-'}
                      {invoice.overdueDays > 0 && <span className="ml-1.5 text-xs font-medium text-destructive">{invoice.overdueDays}d late</span>}
                    </TD>
                    <TD numeric>{formatMoney(invoice.totalPaise)}</TD>
                    <TD numeric className="font-semibold text-destructive">{formatMoney(invoice.outstandingPaise)}</TD>
                    <TD>
                      <Badge variant={style.variant}>{style.label}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </section>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-serif text-base font-semibold">Statement of account</h2>
          <div className="flex items-end gap-3 print:hidden">
            <Field label="From" className="mb-0">
              <Input type="date" className="h-9" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="To" className="mb-0">
              <Input type="date" className="h-9" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
        </div>
        {statement ? (
          <StatementTable statement={statement} raisesLabel="Billed / paid out" reducesLabel="Received / credited" />
        ) : (
          <Skeleton className="h-40" />
        )}
      </section>

      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />
    </div>
  );
}
