import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useProducts, type ProductSummary } from '../products/productsApi';

/**
 * Pick products to put on an adjustment or a transfer.
 *
 * Searches the server as you type rather than offering a dropdown of everything,
 * because a real catalogue has thousands of items and no dropdown is usable at
 * that size. A barcode scanner types the code and presses Enter, which lands
 * here as an exact-code search and selects the one match immediately.
 */

export interface PickedLine {
  product: ProductSummary;
  quantity: string;
}

export function ProductPicker({
  lines,
  onChange,
  quantityLabel,
  quantityHint,
}: {
  lines: PickedLine[];
  onChange: (lines: PickedLine[]) => void;
  quantityLabel: string;
  quantityHint?: string;
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
    onChange([...lines, { product, quantity: '' }]);
    setTerm('');
    setDebounced('');
  }

  function setQuantity(productId: string, quantity: string) {
    onChange(
      lines.map((line) => (line.product._id === productId ? { ...line, quantity } : line)),
    );
  }

  function remove(productId: string) {
    onChange(lines.filter((line) => line.product._id !== productId));
  }

  return (
    <div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search a product to add, or scan a barcode"
          className="pl-9"
          aria-label="Search products to add"
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
                  <span className="text-xs text-muted-foreground tabular">
                    {product.sku}
                    {product.brandName ? ` - ${product.brandName}` : ''}
                  </span>
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
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Product
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {quantityLabel}
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.product._id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="block font-medium">{line.product.name}</span>
                    <span className="text-xs text-muted-foreground tabular">
                      {line.product.sku}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        className="h-9 w-28 tabular"
                        value={line.quantity}
                        onChange={(event) => setQuantity(line.product._id, event.target.value)}
                        placeholder="0"
                      />
                      <span className="text-xs text-muted-foreground">
                        {line.product.unitSymbol}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove"
                      onClick={() => remove(line.product._id)}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {quantityHint && lines.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">{quantityHint}</p>
      )}
    </div>
  );
}
