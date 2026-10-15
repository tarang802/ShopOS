import { useEffect, useState } from 'react';
import { PAYMENT_METHODS } from '@shopos/shared';
import { ApiRequestError } from '@/lib/apiClient';
import { formatMoney, paiseToInput, parseRupeeInput } from '@/lib/format';
import { PAYMENT_METHOD_LABELS } from '@/lib/statusStyles';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { useRefundSalesReturn } from './salesReturnsApi';

/** Hand back money a customer is owed after a return, up to what they are owed. */
export function RefundDialog({
  open,
  onOpenChange,
  returnId,
  customerName,
  refundDuePaise,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnId: string;
  customerName: string;
  refundDuePaise: number;
}) {
  const refund = useRefundSalesReturn();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(paiseToInput(refundDuePaise));
    setMethod('CASH');
    setReference('');
    setError(null);
  }, [open, refundDuePaise]);

  const amountPaise = parseRupeeInput(amount);
  const valid = amountPaise > 0 && amountPaise <= refundDuePaise;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Refund the customer"
      description={customerName}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={refund.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!valid || refund.isPending}
            onClick={() =>
              refund.mutate(
                { id: returnId, method, amountPaise, ...(reference.trim() ? { reference: reference.trim() } : {}) },
                {
                  onSuccess: () => onOpenChange(false),
                  onError: (cause) => setError(cause instanceof ApiRequestError ? cause.message : 'Could not record the refund'),
                },
              )
            }
          >
            {refund.isPending ? 'Saving...' : 'Record refund'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Owed back to the customer: <span className="font-semibold text-foreground">{formatMoney(refundDuePaise)}</span>
      </p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Amount" error={amount && !valid ? 'More than is owed back' : undefined}>
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
        <Field label="Reference" className="sm:col-span-2">
          <Input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={60} />
        </Field>
      </div>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
