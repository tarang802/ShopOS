import { useEffect, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { formatMoney, parseRupeeInput } from '@/lib/format';
import { Input } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useProducts, type ProductSummary } from '../products/productsApi';

/**
 * Building the lines of a purchase order.
 *
 * Unlike an invoice line, the rate here is typed in by hand - it is what the
 * business pays the supplier, which has nothing to do with the pricing engine
 * that governs what customers are charged.
 */

export interface DraftPOLine {
  product: ProductSummary;
  quantity: string;
  unitPrice: string;
}

export function PurchaseOrderLinePicker({
  lines,
  onChange,
}: {
  lines: DraftPOLine[];
  onChange: (lines: DraftPOLine[]) => void;
}) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const { data } = useProducts({ search: debounced, limit: 8 });
  const results = debounced ? (data?.items ?? []) : [];
  const chosenIds = new Set(lines.map((line) => line.product._id));

  function add(product: ProductSummary) {
    if (chosenIds.has(product._id)) return;
    onChange([...lines, { product, quantity: '1', unitPrice: '' }]);
    setTerm('');
    setDebounced('');
  }

  function update(productId: string, patch: Partial<DraftPOLine>) {
    onChange(lines.map((line) => (line.product._id === productId ? { ...line, ...patch } : line)));
  }

  function remove(productId: string) {
    onChange(lines.filter((line) => line.product._id !== productId));
  }

  const totalPaise = lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * parseRupeeInput(line.unitPrice),
    0,
  );

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search a product to add"
          className="pl-9"
        />
      </div>

      {results.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover">
          {results.map((product) => (
            <li key={product._id}>
              <button
                type="button"
                onClick={() => add(product)}
                disabled={chosenIds.has(product._id)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{product.name}</span>
                  <span className="text-xs text-muted-foreground tabular">{product.sku}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {chosenIds.has(product._id) ? 'Added' : product.unitSymbol}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quantity</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rate</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lineTotal = Number(line.quantity || 0) * parseRupeeInput(line.unitPrice);
                return (
                  <tr key={line.product._id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <span className="block font-medium">{line.product.name}</span>
                      <span className="text-xs text-muted-foreground tabular">{line.product.sku}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        className="h-9 w-24 tabular"
                        value={line.quantity}
                        onChange={(event) => update(line.product._id, { quantity: event.target.value })}
                      />
                      <span className="ml-1.5 text-xs text-muted-foreground">{line.product.unitSymbol}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="relative w-28">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Rs</span>
                        <Input
                          inputMode="decimal"
                          className="h-9 pl-7 tabular"
                          value={line.unitPrice}
                          onChange={(event) => update(line.product._id, { unitPrice: event.target.value })}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular">{formatMoney(lineTotal)}</td>
                    <td className="px-3 py-2">
                      <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => remove(line.product._id)}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex justify-end border-t border-border p-3">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-base font-semibold tabular">{formatMoney(totalPaise)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
