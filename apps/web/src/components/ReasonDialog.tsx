import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';

/**
 * Confirm a consequential action and say why.
 *
 * Voiding a payment or cancelling a document changes what other staff see, and a
 * reason typed now is what someone reads in the activity log months later when they
 * ask why a bill was re-opened.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <p className="mb-4 text-sm text-muted-foreground">{message}</p>
      <Field label="Reason" hint="Kept in the activity log">
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={240} />
      </Field>
      {error && <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => onConfirm(reason.trim())} disabled={busy}>
          {busy ? 'Working...' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
