import { useEffect, useState } from 'react';
import { RETURN_REASONS } from '@shopos/shared';
import { ApiRequestError } from '@/lib/apiClient';
import { formatMoney, formatNumber } from '@/lib/format';
import { RETURN_REASON_LABELS } from '@/lib/statusStyles';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { useCreatePurchaseReturn, type PurchaseOrderDetail } from './purchasingApi';

/**
 * Send goods back to a supplier against the order that delivered them.
 *
 * Only what the order actually delivered, and has not already sent back, can go.
 * The stock leaves the receiving branch and the value comes off what is owed.
 */
export function PurchaseReturnDialog({
  open,
  onOpenChange,
  purchaseOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrder: PurchaseOrderDetail;
}) {
  const create = useCreatePurchaseReturn();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('DEFECTIVE');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const returnable = (item: PurchaseOrderDetail['items'][number]) => item.receivedQty - (item.returnedQty ?? 0);

  useEffect(() => {
    if (!open) return;
    setQuantities({});
    setReason('DEFECTIVE');
    setNotes('');
    setError(null);
  }, [open]);

  const chosen = purchaseOrder.items
    .map((item) => ({ item, quantity: Number(quantities[item.productId] ?? 0) }))
    .filter(({ quantity }) => quantity > 0);
  const value = chosen.reduce((sum, { item, quantity }) => sum + Math.round(item.unitPricePaise * quantity), 0);
  const valid = chosen.length > 0 && chosen.every(({ item, quantity }) => quantity <= returnable(item));

  function submit() {
    setError(null);
    create.mutate(
      {
        purchaseOrderId: purchaseOrder._id,
        reason,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: chosen.map(({ item, quantity }) => ({ productId: item.productId, quantity })),
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
      title="Return goods to supplier"
      description={`${purchaseOrder.number} - ${purchaseOrder.supplierName}`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>
            {create.isPending ? 'Saving...' : 'Record return'}
          </Button>
        </>
      }
    >
      <div className="mb-4 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Product</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Can send back</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Sending back</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrder.items.map((item) => {
              const left = returnable(item);
              return (
                <tr key={item.productId} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{item.productName}</td>
                  <td className="px-3 py-2 text-right tabular">
                    {formatNumber(left)} {item.unitSymbol}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      min={0}
                      max={left}
                      disabled={left <= 0}
                      className="ml-auto h-9 w-28 tabular"
                      value={quantities[item.productId] ?? ''}
                      onChange={(event) => setQuantities((current) => ({ ...current, [item.productId]: event.target.value }))}
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
            {Object.values(RETURN_REASONS).map((option) => (
              <option key={option} value={option}>
                {RETURN_REASON_LABELS[option] ?? option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" />
        </Field>
      </div>

      {value > 0 && (
        <p className="mb-2 text-sm">
          Comes off what you owe: <span className="font-semibold tabular">{formatMoney(value)}</span>
        </p>
      )}

      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
