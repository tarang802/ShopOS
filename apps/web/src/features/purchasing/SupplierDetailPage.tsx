import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, IndianRupee, Pencil, Printer } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { formatDate, formatMoney } from '@/lib/format';
import { PAYABLE_STATUS, statusOf } from '@/lib/statusStyles';
import { PrintHeader } from '@/components/PrintHeader';
import { StatementTable } from '@/components/StatementTable';
import { StatTile } from '@/components/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { SupplierFormDialog } from './SupplierFormDialog';
import { SupplierPaymentDialog } from './SupplierPaymentDialog';
import { usePayableOrders, useSupplierStatement, useSupplierSummary } from './purchasingApi';

/**
 * One supplier's account: what is owed, how late, the orders still to be paid, and
 * the full statement of goods received, payments made and goods sent back.
 */
export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canManage = useHasPermission(PERMISSIONS.SUPPLIERS_MANAGE);
  const canPay = useHasPermission(PERMISSIONS.PURCHASES_PAY);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: summary, isPending, isError, error, refetch } = useSupplierSummary(id);
  const { data: statement } = useSupplierStatement(id, {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const { data: payable } = usePayableOrders(id);

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <ErrorState message={error instanceof Error ? error.message : 'Could not load this supplier'} onRetry={() => void refetch()} />
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

  const { supplier } = summary;

  return (
    <div className="mx-auto max-w-5xl">
      <PrintHeader title="Supplier statement" />

      <Link to="/suppliers" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All suppliers
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b-[3px] border-double border-brass/70 pb-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-primary">{supplier.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[supplier.phone, supplier.city, supplier.gstin && `GSTIN ${supplier.gstin}`].filter(Boolean).join('  -  ') || 'No contact details'}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {supplier.creditDays ? `${supplier.creditDays} days to pay after delivery` : 'Paid on delivery'}
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
          {canPay && (
            <Button onClick={() => setPayOpen(true)} disabled={(payable?.length ?? 0) === 0}>
              <IndianRupee className="h-4 w-4" aria-hidden />
              Pay supplier
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="You owe"
          value={formatMoney(summary.owedPaise)}
          hint={`${summary.openOrders} order${summary.openOrders === 1 ? '' : 's'} unpaid`}
          {...(summary.owedPaise > 0 ? { tone: 'warning' as const } : {})}
        />
        <StatTile
          label="Overdue"
          value={formatMoney(summary.overduePaise)}
          hint={`${summary.overdueOrders} past due`}
          {...(summary.overduePaise > 0 ? { tone: 'danger' as const } : {})}
        />
        <StatTile label="Bought, lifetime" value={formatMoney(summary.lifetimePurchasesPaise)} hint={`${summary.orderCount} orders`} />
        <StatTile label="Last order" value={summary.lastOrderDate ? formatDate(summary.lastOrderDate) : '-'} />
      </div>

      {payable && payable.length > 0 && (
        <section className="mb-6 print:hidden">
          <h2 className="mb-2 font-serif text-base font-semibold">Orders awaiting payment</h2>
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Due</TH>
                <TH numeric>Order total</TH>
                <TH numeric>Owed now</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {payable.map((order) => {
                const style = statusOf(PAYABLE_STATUS, order.payableStatus);
                return (
                  <TR key={order._id}>
                    <TD>
                      <Link to={`/purchases/${order._id}`} className="font-medium tabular hover:text-primary hover:underline">
                        {order.number}
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {order.dueDate ? formatDate(order.dueDate) : 'Not yet delivered'}
                      {order.overdueDays > 0 && <span className="ml-1.5 text-xs font-medium text-destructive">{order.overdueDays}d late</span>}
                    </TD>
                    <TD numeric>{formatMoney(order.totalPaise)}</TD>
                    <TD numeric className={order.owedPaise > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                      {order.owedPaise > 0 ? formatMoney(order.owedPaise) : '-'}
                    </TD>
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
          <StatementTable statement={statement} raisesLabel="Goods received" reducesLabel="Paid / sent back" />
        ) : (
          <Skeleton className="h-40" />
        )}
      </section>

      <SupplierFormDialog open={editOpen} onOpenChange={setEditOpen} supplier={supplier} />
      <SupplierPaymentDialog open={payOpen} onOpenChange={setPayOpen} supplierId={supplier._id} supplierName={supplier.name} />
    </div>
  );
}
