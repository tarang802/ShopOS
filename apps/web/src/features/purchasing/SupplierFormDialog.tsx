import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/apiClient';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { useCreateSupplier, useUpdateSupplier, type Supplier } from './purchasingApi';

/** Add or edit a supplier, including how many days they give the business to pay. */
export function SupplierFormDialog({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: Supplier;
}) {
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const [form, setForm] = useState({ name: '', phone: '', city: '', gstin: '', creditDays: '0' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: supplier?.name ?? '',
      phone: supplier?.phone ?? '',
      city: supplier?.city ?? '',
      gstin: supplier?.gstin ?? '',
      creditDays: String(supplier?.creditDays ?? 0),
    });
    setError(null);
  }, [open, supplier]);

  const busy = create.isPending || update.isPending;

  function submit() {
    setError(null);
    const input = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      city: form.city.trim(),
      gstin: form.gstin.trim(),
      creditDays: Math.min(365, Math.max(0, Math.round(Number(form.creditDays) || 0))),
    };
    const done = {
      onSuccess: () => onOpenChange(false),
      onError: (cause: unknown) =>
        setError(cause instanceof ApiRequestError ? cause.message : 'Could not save the supplier'),
    };

    if (supplier) update.mutate({ id: supplier._id, ...input }, done);
    else create.mutate(input, done);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={supplier ? 'Edit supplier' : 'Add supplier'}
      description={supplier ? 'सप्लायर बदलें' : 'सप्लायर जोड़ें'}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!form.name.trim() || busy}>
            {busy ? 'Saving...' : supplier ? 'Save changes' : 'Add supplier'}
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <Input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Sharma Wholesale Traders" autoFocus />
      </Field>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={(e) => setForm((c) => ({ ...c, city: e.target.value }))} />
        </Field>
        <Field label="GSTIN">
          <Input value={form.gstin} onChange={(e) => setForm((c) => ({ ...c, gstin: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Credit days" hint="Days they give you to pay after delivery">
          <Input type="number" min={0} max={365} value={form.creditDays} onChange={(e) => setForm((c) => ({ ...c, creditDays: e.target.value }))} />
        </Field>
      </div>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
