import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/lib/apiClient';
import { formatNumber } from '@/lib/format';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import type { DocumentLine } from './quotationsApi';
import { useInvoiceSalesOrder } from './salesOrdersApi';

/**
 * Bill all or part of a sales order.
 *
 * Starts with everything still outstanding, because the common case is dispatching
 * the lot; reduce a quantity to bill only what is going out today. The rates are the
 * ones agreed on the order, whatever today's rate card says.
 */
export function InvoiceOrderDialog({
  open,
  onOpenChange,
  orderId,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  items: DocumentLine[];
}) {
  const navigate = useNavigate();
  const invoice = useInvoiceSalesOrder();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const outstanding = (line: DocumentLine) => Math.max(0, line.quantity - (line.invoicedQty ?? 0));

  useEffect(() => {
    if (!open) return;
    setQuantities(Object.fromEntries(items.map((line) => [line.productId, String(outstanding(line))])));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items]);

  const chosen = items
    .map((line) => ({ line, quantity: Number(quantities[line.productId] ?? 0) }))
    .filter(({ quantity }) => quantity > 0);
  const valid = chosen.length > 0 && chosen.every(({ line, quantity }) => quantity <= outstanding(line));

  function submit() {
    setError(null);
    invoice.mutate(
      { id: orderId, items: chosen.map(({ line, quantity }) => ({ productId: line.productId, quantity })) },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          navigate(`/sales/${result.invoice._id}`);
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
      title="Invoice this order"
      description="Choose how much to bill now"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={invoice.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || invoice.isPending}>
            {invoice.isPending ? 'Creating...' : 'Create invoice'}
          </Button>
        </>
      }
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Product</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Left to bill</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Bill now</th>
            </tr>
          </thead>
          <tbody>
            {items.map((line) => {
              const left = outstanding(line);
              const entered = Number(quantities[line.productId] ?? 0);
              return (
                <tr key={line.productId} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{line.productName}</td>
                  <td className="px-3 py-2 text-right tabular">
                    {formatNumber(left)} {line.unitSymbol}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      min={0}
                      max={left}
                      disabled={left === 0}
                      aria-invalid={entered > left}
                      className="ml-auto h-9 w-28 tabular"
                      value={quantities[line.productId] ?? ''}
                      onChange={(event) => setQuantities((current) => ({ ...current, [line.productId]: event.target.value }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
