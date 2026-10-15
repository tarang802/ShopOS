import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/lib/apiClient';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { DocumentFields, TotalsPanel, linesToInput, useDocumentForm } from './DocumentForm';
import { useCreateSalesOrder } from './salesOrdersApi';

/** A new sales order: a promise to supply, billed as the goods go out. */
export function NewSalesOrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const form = useDocumentForm(open);
  const create = useCreateSalesOrder();

  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setExpectedDate('');
    setNotes('');
    setError(null);
  }, [open]);

  function submit() {
    setError(null);
    create.mutate(
      {
        branchId: form.branchId,
        ...(form.customerId ? { customerId: form.customerId } : {}),
        ...(expectedDate ? { expectedDate } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: linesToInput(form),
      },
      {
        onSuccess: (order) => {
          onOpenChange(false);
          navigate(`/sales-orders/${order._id}`);
        },
        onError: (cause) =>
          setError(cause instanceof ApiRequestError ? cause.message : 'Could not create the order'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="New sales order"
      description="नया बिक्री ऑर्डर"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!form.ready || create.isPending}>
            {create.isPending ? 'Creating...' : 'Create order'}
          </Button>
        </>
      }
    >
      <DocumentFields
        form={form}
        extra={
          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label="Wanted by" hint="Optional">
              <Input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" />
            </Field>
          </div>
        }
      />

      <TotalsPanel totals={form.totals} />

      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
