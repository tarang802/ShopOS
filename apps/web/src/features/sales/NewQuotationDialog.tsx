import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/lib/apiClient';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { DocumentFields, TotalsPanel, linesToInput, useDocumentForm } from './DocumentForm';
import { useCreateQuotation } from './quotationsApi';

/** A new quotation: an offer at today's rates that stands for a number of days. */
export function NewQuotationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const form = useDocumentForm(open);
  const create = useCreateQuotation();

  const [validDays, setValidDays] = useState('15');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValidDays('15');
    setNotes('');
    setTerms('');
    setError(null);
  }, [open]);

  function submit() {
    setError(null);
    create.mutate(
      {
        branchId: form.branchId,
        ...(form.customerId ? { customerId: form.customerId } : {}),
        validDays: Math.min(365, Math.max(1, Math.round(Number(validDays) || 15))),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(terms.trim() ? { terms: terms.trim() } : {}),
        items: linesToInput(form),
      },
      {
        onSuccess: (quotation) => {
          onOpenChange(false);
          navigate(`/quotations/${quotation._id}`);
        },
        onError: (cause) =>
          setError(cause instanceof ApiRequestError ? cause.message : 'Could not create the quotation'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="New quotation"
      description="नया कोटेशन"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!form.ready || create.isPending}>
            {create.isPending ? 'Creating...' : 'Create quotation'}
          </Button>
        </>
      }
    >
      <DocumentFields
        form={form}
        extra={
          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label="Valid for (days)" hint="The offer lapses after this">
              <Input type="number" min={1} max={365} value={validDays} onChange={(event) => setValidDays(event.target.value)} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Terms" className="sm:col-span-3">
              <Input value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Delivery, payment terms, anything the customer should know" />
            </Field>
          </div>
        }
      />

      <TotalsPanel totals={form.totals} />

      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
