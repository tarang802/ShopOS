import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/apiClient';
import { paiseToInput, parseRupeeInput } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { useCreateCustomer, useUpdateCustomer, type Customer } from './customersApi';

/**
 * Add or edit a customer, including the terms that govern how they pay: how many
 * days they are given and the most they may owe at once.
 */
export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When given, the dialog edits this customer instead of adding a new one. */
  customer?: Customer;
}) {
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const [form, setForm] = useState({ name: '', phone: '', city: '', gstin: '', creditDays: '0', creditLimit: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      city: customer?.city ?? '',
      gstin: customer?.gstin ?? '',
      creditDays: String(customer?.creditDays ?? 0),
      creditLimit: customer?.creditLimitPaise ? paiseToInput(customer.creditLimitPaise) : '',
    });
    setError(null);
  }, [open, customer]);

  const busy = create.isPending || update.isPending;

  function submit() {
    setError(null);
    const input = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      city: form.city.trim(),
      gstin: form.gstin.trim(),
      creditDays: Math.min(365, Math.max(0, Math.round(Number(form.creditDays) || 0))),
      ...(form.creditLimit.trim() ? { creditLimitPaise: parseRupeeInput(form.creditLimit) } : {}),
    };
    const done = {
      onSuccess: () => onOpenChange(false),
      onError: (cause: unknown) =>
        setError(cause instanceof ApiRequestError ? cause.message : 'Could not save the customer'),
    };

    if (customer) update.mutate({ id: customer._id, ...input }, done);
    else create.mutate(input, done);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={customer ? 'Edit customer' : 'Add customer'}
      description={customer ? 'ग्राहक बदलें' : 'ग्राहक जोड़ें'}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!form.name.trim() || busy}>
            {busy ? 'Saving...' : customer ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <Input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Verma Stationery Mart" autoFocus />
      </Field>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={(e) => setForm((c) => ({ ...c, city: e.target.value }))} />
        </Field>
        <Field label="GSTIN" className="sm:col-span-2">
          <Input value={form.gstin} onChange={(e) => setForm((c) => ({ ...c, gstin: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Credit days" hint="Days allowed to pay. 0 means on the spot">
          <Input type="number" min={0} max={365} value={form.creditDays} onChange={(e) => setForm((c) => ({ ...c, creditDays: e.target.value }))} />
        </Field>
        <Field label="Credit limit" hint="Most they may owe. Blank for none">
          <Input inputMode="decimal" className="tabular" value={form.creditLimit} onChange={(e) => setForm((c) => ({ ...c, creditLimit: e.target.value }))} />
        </Field>
      </div>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
