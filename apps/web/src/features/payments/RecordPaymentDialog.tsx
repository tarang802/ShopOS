import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHODS } from '@shopos/shared';
import { api, ApiRequestError } from '@/lib/apiClient';
import { formatMoney, paiseToInput, parseRupeeInput } from '@/lib/format';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';

/**
 * Record a payment against one invoice.
 *
 * Deliberately scoped to a single invoice rather than a free-standing "record
 * a payment, then pick invoices" screen - in a shop, a payment nearly always
 * happens because someone is looking at one specific bill. Multi-invoice
 * settlement can be added later without changing this component.
 */

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
  CHEQUE: 'Cheque',
  CREDIT: 'On credit (pay later)',
};

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  branchId,
  customerId,
  customerName,
  outstandingPaise,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  branchId: string;
  customerId?: string;
  customerName: string;
  outstandingPaise: number;
}) {
  const client = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(paiseToInput(outstandingPaise));
      setMethod('CASH');
      setError(null);
    }
  }, [open, outstandingPaise]);

  const record = useMutation({
    mutationFn: (amountPaise: number) =>
      api.post('/payments', {
        branchId,
        ...(customerId ? { customerId } : {}),
        amountPaise,
        method,
        allocations: [{ invoiceId, amountPaise }],
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
    },
    onError: (cause) =>
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not record the payment'),
  });

  const amountPaise = parseRupeeInput(amount);
  const valid = amountPaise > 0 && amountPaise <= outstandingPaise;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record payment"
      description={`${customerName} - भुगतान दर्ज करें`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={record.isPending}>
            Cancel
          </Button>
          <Button onClick={() => record.mutate(amountPaise)} disabled={!valid || record.isPending}>
            {record.isPending ? 'Saving...' : 'Record payment'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Outstanding balance: <span className="font-semibold text-foreground">{formatMoney(outstandingPaise)}</span>
      </p>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Amount" required error={amount && !valid ? 'Cannot exceed the outstanding balance' : undefined}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rs</span>
            <Input
              className="pl-9 tabular"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
            />
          </div>
        </Field>
        <Field label="Method" required>
          <Select value={method} onChange={(event) => setMethod(event.target.value)}>
            {Object.values(PAYMENT_METHODS).map((value) => (
              <option key={value} value={value}>
                {METHOD_LABELS[value] ?? value}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}
