import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Receipt } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { useAuthStore } from '@/stores/authStore';
import { formatDate, formatMoney } from '@/lib/format';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useInvoices, type InvoiceSummary } from './invoicesApi';
import { NewInvoiceDialog } from './NewInvoiceDialog';

const STATUS_STYLE: Record<InvoiceSummary['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  ISSUED: { label: 'Issued', variant: 'default' },
  PARTIALLY_PAID: { label: 'Partially paid', variant: 'warning' },
  PAID: { label: 'Paid', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

export function InvoicesPage() {
  const canCreate = useHasPermission(PERMISSIONS.SALES_CREATE);
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const [status, setStatus] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const { data, isPending, isError, error, refetch } = useInvoices({
    branchId: activeBranchId,
    status: status || undefined,
  });

  const invoices = data?.items ?? [];

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

      <div className="mb-4">
        <Select className="w-48" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All invoices</option>
          <option value="ISSUED">Issued</option>
          <option value="PARTIALLY_PAID">Partially paid</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : 'Could not load invoices'} onRetry={() => void refetch()} />
      ) : !isPending && invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices yet"
          message="Create your first invoice to record a sale."
          action={canCreate ? <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" aria-hidden />New invoice</Button> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>Date</TH>
              <TH>Customer</TH>
              <TH>Branch</TH>
              <TH numeric>Total</TH>
              <TH numeric>Outstanding</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {isPending ? (
              <TableMessage colSpan={7}>Loading invoices...</TableMessage>
            ) : (
              invoices.map((invoice) => {
                const style = STATUS_STYLE[invoice.status];
                const outstanding = invoice.totalPaise - invoice.paidPaise;
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
                    <TD numeric>{formatMoney(invoice.totalPaise)}</TD>
                    <TD numeric>
                      {outstanding > 0 ? (
                        <span className="font-semibold text-destructive">{formatMoney(outstanding)}</span>
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
      )}

      <NewInvoiceDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
