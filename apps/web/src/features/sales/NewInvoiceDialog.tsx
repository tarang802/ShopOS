import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PAYMENT_METHODS, PERMISSIONS } from '@shopos/shared';
import { ApiRequestError } from '@/lib/apiClient';
import { formatMoney, paiseToInput, parseRupeeInput } from '@/lib/format';
import { PAYMENT_METHOD_LABELS } from '@/lib/statusStyles';
import { useHasPermission } from '@/stores/authStore';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { DocumentFields, TotalsPanel, linesToInput, useDocumentForm } from './DocumentForm';
import { useCreateInvoice } from './invoicesApi';

/**
 * A new invoice, with the counter case first-class: money can be taken in the same
 * step, so a sale paid at the till is one action rather than a bill followed by a
 * separate payment that someone might forget to record.
 */
export function NewInvoiceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const canTakePayment = useHasPermission(PERMISSIONS.PAYMENTS_CREATE);
  const form = useDocumentForm(open);
  const createInvoice = useCreateInvoice();

  const [creditDays, setCreditDays] = useState('0');
  const [notes, setNotes] = useState('');
  const [takePayment, setTakePayment] = useState(false);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNotes('');
    setTakePayment(false);
    setMethod('CASH');
    setReference('');
    setError(null);
  }, [open]);

  // A customer on thirty days' credit gets a due date thirty days out without anyone
  // having to remember it.
  useEffect(() => {
    setCreditDays(String(form.customer?.creditDays ?? 0));
  }, [form.customer]);

  // Offer to take the whole bill, and keep that offer in step as lines change.
  useEffect(() => {
    if (takePayment) setAmount(paiseToInput(form.totals.totalPaise));
  }, [takePayment, form.totals.totalPaise]);

  const paymentPaise = parseRupeeInput(amount);
  const paymentValid =
    !takePayment || (paymentPaise > 0 && paymentPaise <= form.totals.totalPaise);
  const canSubmit = form.ready && paymentValid && !createInvoice.isPending;

  function submit() {
    setError(null);
    createInvoice.mutate(
      {
        branchId: form.branchId,
        ...(form.customerId ? { customerId: form.customerId } : {}),
        creditDays: Math.max(0, Math.round(Number(creditDays) || 0)),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: linesToInput(form),
        ...(takePayment && canTakePayment
          ? {
              payment: {
                method,
                amountPaise: paymentPaise,
                ...(reference.trim() ? { reference: reference.trim() } : {}),
              },
            }
          : {}),
      },
      {
        onSuccess: (invoice) => {
          onOpenChange(false);
          navigate(`/sales/${invoice._id}`);
        },
        onError: (cause) =>
          setError(cause instanceof ApiRequestError ? cause.message : 'Could not create the invoice'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="New invoice"
      description="नया बिल"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createInvoice.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {createInvoice.isPending ? 'Creating...' : takePayment ? 'Create and take payment' : 'Create invoice'}
          </Button>
        </>
      }
    >
      <DocumentFields
        form={form}
        extra={
          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label="Credit days" hint={form.customerId ? 'From the customer, change if needed' : 'Walk-in sales are due today'}>
              <Input
                type="number"
                min={0}
                max={365}
                value={creditDays}
                onChange={(event) => setCreditDays(event.target.value)}
                disabled={!form.customerId}
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" />
            </Field>
          </div>
        }
      />

      <TotalsPanel totals={form.totals} />

      {canTakePayment && form.totals.totalPaise > 0 && (
        <div className="mt-4 rounded-md border border-border p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={takePayment}
              onChange={(event) => setTakePayment(event.target.checked)}
            />
            Take payment now
          </label>

          {takePayment && (
            <div className="mt-3 grid gap-x-4 sm:grid-cols-3">
              <Field
                label="Amount"
                error={!paymentValid ? `Between zero and ${formatMoney(form.totals.totalPaise)}` : undefined}
              >
                <Input
                  className="tabular"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
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
              <Field label="Reference" hint="UPI id or cheque no.">
                <Input value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}
