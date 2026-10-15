import { useEffect, useMemo, useState } from 'react';
import {
  PAYMENT_METHODS,
  RETURN_REASONS,
  invoiceRefundDuePaise,
  proportionalPaise,
} from '@shopos/shared';
import { ApiRequestError } from '@/lib/apiClient';
import { formatMoney, formatNumber, paiseToInput, parseRupeeInput } from '@/lib/format';
import { PAYMENT_METHOD_LABELS, RETURN_REASON_LABELS } from '@/lib/statusStyles';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import type { InvoiceDetail } from './invoicesApi';
import { useCreateSalesReturn } from './salesReturnsApi';

/**
 * Take goods back against an invoice.
 *
 * The credit shown is worked out the way the server will work it - from the
 * invoice's own frozen amounts, cumulatively, so a line returned in several goes
 * never loses a paisa to rounding. If the customer had already paid more than the
 * reduced bill, the dialog offers to hand the difference back in the same step.
 */
export function ReturnGoodsDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceDetail;
}) {
  const createReturn = useCreateSalesReturn();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('DEFECTIVE');
  const [notes, setNotes] = useState('');
  const [refundNow, setRefundNow] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuantities({});
    setRestock(Object.fromEntries(invoice.items.map((line) => [line.productId, true])));
    setReason('DEFECTIVE');
    setNotes('');
    setRefundNow(false);
    setRefundAmount('');
    setMethod('CASH');
    setError(null);
  }, [open, invoice.items]);

  const returnable = (line: InvoiceDetail['items'][number]) => line.quantity - (line.returnedQty ?? 0);

  const chosen = invoice.items
    .map((line) => ({ line, quantity: Number(quantities[line.productId] ?? 0) }))
    .filter(({ quantity }) => quantity > 0);

  const creditPaise = useMemo(
    () =>
      chosen.reduce((sum, { line, quantity }) => {
        const before = line.returnedQty ?? 0;
        return (
          sum +
          proportionalPaise(line.lineTotalPaise, before + quantity, line.quantity) -
          proportionalPaise(line.lineTotalPaise, before, line.quantity)
        );
      }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quantities, invoice.items],
  );

  const refundable = invoiceRefundDuePaise({
    totalPaise: invoice.totalPaise,
    paidPaise: invoice.paidPaise,
    returnedPaise: (invoice.returnedPaise ?? 0) + creditPaise,
    refundedPaise: invoice.refundedPaise ?? 0,
  });

  useEffect(() => {
    if (refundNow) setRefundAmount(paiseToInput(refundable));
  }, [refundNow, refundable]);

  const valid =
    chosen.length > 0 &&
    chosen.every(({ line, quantity }) => quantity <= returnable(line)) &&
    (!refundNow || (parseRupeeInput(refundAmount) > 0 && parseRupeeInput(refundAmount) <= refundable));

  function submit() {
    setError(null);
    createReturn.mutate(
      {
        invoiceId: invoice._id,
        reason,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: chosen.map(({ line, quantity }) => ({
          productId: line.productId,
          quantity,
          restock: restock[line.productId] ?? true,
        })),
        ...(refundNow ? { refund: { method, amountPaise: parseRupeeInput(refundAmount) } } : {}),
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (cause) => setError(cause instanceof ApiRequestError ? cause.message : 'Could not record the return'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Return goods"
      description={`${invoice.number} - ${invoice.customerName}`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createReturn.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || createReturn.isPending}>
            {createReturn.isPending ? 'Saving...' : 'Record return'}
          </Button>
        </>
      }
    >
      <div className="mb-4 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Product</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Can return</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Returning</th>
              <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider">Back on shelf</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((line) => {
              const left = returnable(line);
              return (
                <tr key={line.productId} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{line.productName}</td>
                  <td className="px-3 py-2 text-right tabular">
                    {formatNumber(left)} {line.unitSymbol}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      min={0}
                      max={left}
                      disabled={left <= 0}
                      className="ml-auto h-9 w-24 tabular"
                      value={quantities[line.productId] ?? ''}
                      onChange={(event) => setQuantities((current) => ({ ...current, [line.productId]: event.target.value }))}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Restock ${line.productName}`}
                      className="h-4 w-4 rounded border-input"
                      checked={restock[line.productId] ?? true}
                      onChange={(event) => setRestock((current) => ({ ...current, [line.productId]: event.target.checked }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Reason" required>
          <Select value={reason} onChange={(event) => setReason(event.target.value)}>
            {Object.values(RETURN_REASONS).map((value) => (
              <option key={value} value={value}>
                {RETURN_REASON_LABELS[value] ?? value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" />
        </Field>
      </div>

      {creditPaise > 0 && (
        <div className="mb-4 rounded-md border border-border bg-muted/60 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Credit for these goods</span>
            <span className="font-semibold tabular">{formatMoney(creditPaise)}</span>
          </div>
          {refundable > 0 && (
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">Owed back to the customer</span>
              <span className="font-semibold tabular">{formatMoney(refundable)}</span>
            </div>
          )}
        </div>
      )}

      {refundable > 0 && (
        <div className="rounded-md border border-border p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={refundNow}
              onChange={(event) => setRefundNow(event.target.checked)}
            />
            Hand the money back now
          </label>
          {refundNow && (
            <div className="mt-3 grid gap-x-4 sm:grid-cols-2">
              <Field label="Amount" error={!valid && refundNow ? `Up to ${formatMoney(refundable)}` : undefined}>
                <Input className="tabular" inputMode="decimal" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} />
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
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
