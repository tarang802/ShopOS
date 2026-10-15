import { useEffect, useMemo, useState } from 'react';
import { PAYMENT_METHODS } from '@shopos/shared';
import { ApiRequestError } from '@/lib/apiClient';
import { formatDate, formatMoney, paiseToInput, parseRupeeInput } from '@/lib/format';
import { PAYMENT_METHOD_LABELS } from '@/lib/statusStyles';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { usePayableOrders, useRecordSupplierPayment } from './purchasingApi';

/**
 * Pay a supplier.
 *
 * Enter what is being paid and it is applied to the oldest bills first, up to what
 * can still be paid on each, which is how a payment is settled in practice. The
 * dialog shows exactly where the money will go before anything is saved, because a
 * payment must be fully applied - none of it can be left unexplained.
 */
export function SupplierPaymentDialog({
  open,
  onOpenChange,
  supplierId,
  supplierName,
  onlyOrderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
  /** Restrict the payment to one purchase order, when paying from its own page. */
  onlyOrderId?: string;
}) {
  const { data: allOrders } = usePayableOrders(supplierId, open);
  const record = useRecordSupplierPayment();

  const orders = useMemo(
    () => (allOrders ?? []).filter((order) => !onlyOrderId || order._id === onlyOrderId),
    [allOrders, onlyOrderId],
  );
  const totalCap = orders.reduce((sum, order) => sum + order.payableCapPaise, 0);
  const owedNow = orders.reduce((sum, order) => sum + order.owedPaise, 0);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMethod('BANK_TRANSFER');
    setReference('');
    setError(null);
  }, [open]);

  // Start with what is actually owed, which is what people mean to pay.
  useEffect(() => {
    if (open) setAmount(paiseToInput(owedNow));
  }, [open, owedNow]);

  const amountPaise = parseRupeeInput(amount);

  const allocations = useMemo(() => {
    let remaining = amountPaise;
    const result: { order: (typeof orders)[number]; amountPaise: number }[] = [];
    for (const order of orders) {
      if (remaining <= 0) break;
      const share = Math.min(remaining, order.payableCapPaise);
      if (share > 0) {
        result.push({ order, amountPaise: share });
        remaining -= share;
      }
    }
    return result;
  }, [orders, amountPaise]);

  const valid = amountPaise > 0 && amountPaise <= totalCap && allocations.length > 0;

  function submit() {
    setError(null);
    const first = allocations[0]?.order;
    if (!first) return;
    record.mutate(
      {
        branchId: first.branchId,
        supplierId,
        amountPaise,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        allocations: allocations.map(({ order, amountPaise: share }) => ({
          purchaseOrderId: order._id,
          amountPaise: share,
        })),
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (cause) => setError(cause instanceof ApiRequestError ? cause.message : 'Could not record the payment'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Pay supplier"
      description={supplierName}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={record.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || record.isPending}>
            {record.isPending ? 'Saving...' : 'Record payment'}
          </Button>
        </>
      }
    >
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is payable to this supplier right now.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Owed for goods received: <span className="font-semibold text-foreground">{formatMoney(owedNow)}</span>
            {totalCap > owedNow && <> - up to {formatMoney(totalCap)} can be paid, including deposits on goods still to come.</>}
          </p>

          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label="Amount" error={amount && !valid ? `Between zero and ${formatMoney(totalCap)}` : undefined}>
              <Input className="tabular" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus />
            </Field>
            <Field label="Method">
              <Select value={method} onChange={(event) => setMethod(event.target.value)}>
                {Object.values(PAYMENT_METHODS).map((value) => (
                  <option key={value} value={value}>
                    {PAYMENT_METHOD_LABELS[value] ?? value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference">
              <Input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={60} />
            </Field>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Order</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Due</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Owed</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">This payment</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const share = allocations.find((a) => a.order._id === order._id)?.amountPaise ?? 0;
                  return (
                    <tr key={order._id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium tabular">{order.number}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {order.dueDate ? formatDate(order.dueDate) : 'Not yet delivered'}
                        {order.overdueDays > 0 && <span className="ml-1.5 text-xs font-medium text-destructive">{order.overdueDays}d late</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular">{formatMoney(order.owedPaise)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular">{share > 0 ? formatMoney(share) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
