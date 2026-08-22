import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Trash2 } from 'lucide-react';
import { api, toQuery } from '@/lib/apiClient';
import { formatMoney } from '@/lib/format';
import { Input } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useProducts, type ProductSummary } from '../products/productsApi';

/**
 * Building the lines of an invoice.
 *
 * Each line's rate is never typed in - it is fetched live from the same
 * pricing engine the server will use to actually create the invoice. What a
 * staff member sees here, quantity by quantity, is exactly what the bill will
 * say, because both paths call the identical resolver.
 */

export interface DraftLine {
  product: ProductSummary;
  quantity: string;
}

interface ResolvedPrice {
  unitPricePaise: number;
  lineTotalPaise: number;
  appliedTier: { range: string };
}

function LineRow({
  line,
  priceListId,
  onQuantityChange,
  onRemove,
  onResolved,
}: {
  line: DraftLine;
  priceListId: string;
  onQuantityChange: (quantity: string) => void;
  onRemove: () => void;
  onResolved: (lineTotalPaise: number | null) => void;
}) {
  const quantity = Number(line.quantity);
  const enabled = Boolean(priceListId) && Number.isFinite(quantity) && quantity > 0;

  const { data, isFetching, error } = useQuery({
    queryKey: ['invoice-line-price', line.product._id, priceListId, quantity],
    queryFn: () =>
      api.get<ResolvedPrice>(`/pricing/resolve${toQuery({ productId: line.product._id, priceListId, quantity })}`),
    enabled,
    retry: false,
  });

  useEffect(() => {
    onResolved(data ? data.lineTotalPaise : null);
    // Only the resolved total matters to the parent; re-running on every
    // render would create an update loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <tr className="border-t border-border">
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
          onChange={(event) => onQuantityChange(event.target.value)}
        />
        <span className="ml-1.5 text-xs text-muted-foreground">{line.product.unitSymbol}</span>
      </td>
      <td className="px-3 py-2 text-right tabular">
        {!enabled ? (
          <span className="text-muted-foreground">-</span>
        ) : isFetching ? (
          <span className="text-muted-foreground">...</span>
        ) : error ? (
          <span className="text-destructive text-xs">No rate</span>
        ) : (
          <>
            {formatMoney(data!.unitPricePaise)}
            <span className="block text-xs text-muted-foreground">{data!.appliedTier.range}</span>
          </>
        )}
      </td>
      <td className="px-3 py-2 text-right font-semibold tabular">
        {enabled && data ? formatMoney(data.lineTotalPaise) : '-'}
      </td>
      <td className="px-3 py-2">
        <Button variant="ghost" size="icon" aria-label="Remove" onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      </td>
    </tr>
  );
}

export function InvoiceLinePicker({
  lines,
  onChange,
  priceListId,
  onTotalsChange,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  priceListId: string;
  onTotalsChange: (totalPaise: number) => void;
}) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [lineTotals, setLineTotals] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const { data } = useProducts({ search: debounced, limit: 8 });
  const results = debounced ? (data?.items ?? []) : [];
  const chosenIds = new Set(lines.map((line) => line.product._id));

  useEffect(() => {
    const relevant = Object.entries(lineTotals).filter(([id]) => chosenIds.has(id));
    onTotalsChange(relevant.reduce((sum, [, total]) => sum + total, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineTotals, lines.length]);

  function add(product: ProductSummary) {
    if (chosenIds.has(product._id)) return;
    onChange([...lines, { product, quantity: '1' }]);
    setTerm('');
    setDebounced('');
  }

  function setQuantity(productId: string, quantity: string) {
    onChange(lines.map((line) => (line.product._id === productId ? { ...line, quantity } : line)));
  }

  function remove(productId: string) {
    onChange(lines.filter((line) => line.product._id !== productId));
    setLineTotals((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search a product to add, or scan a barcode"
          className="pl-9"
          disabled={!priceListId}
        />
      </div>
      {!priceListId && (
        <p className="mt-1 text-xs text-muted-foreground">Select a rate type above before adding products.</p>
      )}

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
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rate</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subtotal</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <LineRow
                  key={line.product._id}
                  line={line}
                  priceListId={priceListId}
                  onQuantityChange={(quantity) => setQuantity(line.product._id, quantity)}
                  onRemove={() => remove(line.product._id)}
                  onResolved={(total) =>
                    setLineTotals((current) => ({ ...current, [line.product._id]: total ?? 0 }))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
