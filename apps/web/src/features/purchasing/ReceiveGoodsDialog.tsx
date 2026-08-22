import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/apiClient';
import { formatNumber } from '@/lib/format';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { useReceiveGoods, type PurchaseOrderDetail } from './purchasingApi';

/**
 * Recording goods that arrived against a purchase order.
 *
 * Defaults every line to its outstanding quantity (ordered minus already
 * received), since a full delivery is the common case - a partial delivery
 * just means editing the lines that fell short.
 */
export function ReceiveGoodsDialog({
  open,
  onOpenChange,
  purchaseOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrder: PurchaseOrderDetail;
}) {
  const receiveGoods = useReceiveGoods();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const outstandingLines = purchaseOrder.items.filter((item) => item.receivedQty < item.orderedQty);

  useEffect(() => {
    if (!open) return;
    setQuantities(
      Object.fromEntries(outstandingLines.map((item) => [item.productId, String(item.orderedQty - item.receivedQty)])),
    );
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, purchaseOrder._id]);

  const items = outstandingLines
    .map((item) => ({
      productId: item.productId,
      receivedQty: Number(quantities[item.productId] || 0),
      outstanding: item.orderedQty - item.receivedQty,
    }))
    .filter((item) => item.receivedQty > 0);

  const ready = items.length > 0 && items.every((item) => item.receivedQty <= item.outstanding);

  function submit() {
    setError(null);
    receiveGoods.mutate(
      {
        id: purchaseOrder._id,
        input: { items: items.map(({ productId, receivedQty }) => ({ productId, receivedQty })) },
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (cause) =>
          setError(cause instanceof ApiRequestError ? cause.message : 'Could not record the goods receipt'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Receive goods"
      description="माल प्राप्ति दर्ज करें"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={receiveGoods.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || receiveGoods.isPending}>
            {receiveGoods.isPending ? 'Saving...' : 'Record receipt'}
          </Button>
        </>
      }
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outstanding</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receiving now</th>
            </tr>
          </thead>
          <tbody>
            {outstandingLines.map((item) => {
              const outstanding = item.orderedQty - item.receivedQty;
              return (
                <tr key={item.productId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="block font-medium">{item.productName}</span>
                    <span className="text-xs text-muted-foreground tabular">{item.sku}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular text-muted-foreground">
                    {formatNumber(outstanding)} {item.unitSymbol}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      max={outstanding}
                      className="h-9 w-28 tabular"
                      value={quantities[item.productId] ?? ''}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [item.productId]: event.target.value }))
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}
