import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { validateTiers, type PriceTier } from '@shopos/shared';
import { api, ApiRequestError } from '@/lib/apiClient';
import { paiseToInput, parseRupeeInput } from '@/lib/format';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { productKeys } from './productsApi';

/**
 * The rate card editor - the screen this whole product exists for.
 *
 * It is laid out as a shop rate list, because that is what an owner already has
 * on paper:
 *
 *   From   To     Rate
 *   1      9      5.00
 *   10     49     4.80
 *   50     99     4.50
 *   100    and up 4.20
 *
 * The slabs are checked as they are typed using the SAME functions the server
 * uses to accept or reject them. That shared code is why the preview here can
 * never disagree with what the server decides - and the server still validates
 * again, because a browser check protects nothing.
 *
 * Leaving the last "To" blank means "and above", which is how every open-ended
 * bulk rate is written.
 */

interface EditableTier {
  minQuantity: string;
  maxQuantity: string;
  rate: string;
}

function toEditable(tiers: PriceTier[]): EditableTier[] {
  if (tiers.length === 0) {
    return [{ minQuantity: '1', maxQuantity: '', rate: '' }];
  }
  return tiers.map((tier) => ({
    minQuantity: String(tier.minQuantity),
    maxQuantity: tier.maxQuantity === null ? '' : String(tier.maxQuantity),
    rate: paiseToInput(tier.pricePaise),
  }));
}

function toTiers(rows: EditableTier[]): PriceTier[] {
  return rows.map((row) => ({
    minQuantity: Number.parseInt(row.minQuantity, 10) || 0,
    maxQuantity: row.maxQuantity.trim() === '' ? null : Number.parseInt(row.maxQuantity, 10) || 0,
    pricePaise: parseRupeeInput(row.rate),
  }));
}

export function RateCardDialog({
  open,
  onOpenChange,
  productId,
  productName,
  priceListId,
  priceListName,
  initialTiers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  priceListId: string;
  priceListName: string;
  initialTiers: PriceTier[];
}) {
  const client = useQueryClient();
  const [rows, setRows] = useState<EditableTier[]>(toEditable(initialTiers));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRows(toEditable(initialTiers));
      setError(null);
    }
  }, [open, initialTiers]);

  const save = useMutation({
    mutationFn: (tiers: PriceTier[]) =>
      api.put(`/pricing/products/${productId}`, { priceListId, tiers }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: productKeys.detail(productId) });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      onOpenChange(false);
    },
    onError: (cause) => {
      if (cause instanceof ApiRequestError) {
        // The server returns which slab is at fault, so the message names it.
        const detail = cause.details?.[0]?.message;
        setError(detail ? `${cause.message}: ${detail}` : cause.message);
        return;
      }
      setError('Could not save the rates');
    },
  });

  const tiers = toTiers(rows);
  const validation = validateTiers(tiers);
  const issueByRow = new Map(validation.issues.map((issue) => [issue.index, issue.message]));

  function update(index: number, key: keyof EditableTier, value: string) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    );
  }

  function addRow() {
    setRows((current) => {
      const last = current[current.length - 1];
      // The new slab starts one above where the previous one ended, which is
      // what the owner is about to type anyway.
      const nextMin = last?.maxQuantity ? String(Number(last.maxQuantity) + 1) : '';
      return [...current, { minQuantity: nextMin, maxQuantity: '', rate: '' }];
    });
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`${priceListName} rate`}
      description={productName}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate(tiers)}
            disabled={!validation.valid || save.isPending}
          >
            {save.isPending ? 'Saving...' : 'Save rates'}
          </Button>
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                From qty
              </th>
              <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                To qty
              </th>
              <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Rate per unit
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const issue = issueByRow.get(index);
              const isLast = index === rows.length - 1;
              return (
                <tr key={index} className="align-top">
                  <td className="py-2 pr-2">
                    <Input
                      type="number"
                      min={1}
                      className="h-9 w-24 tabular"
                      value={row.minQuantity}
                      onChange={(event) => update(index, 'minQuantity', event.target.value)}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      type="number"
                      min={1}
                      className="h-9 w-24 tabular"
                      value={row.maxQuantity}
                      placeholder={isLast ? 'and above' : ''}
                      onChange={(event) => update(index, 'maxQuantity', event.target.value)}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <div className="relative w-32">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        Rs
                      </span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        className="h-9 pl-9 tabular"
                        value={row.rate}
                        onChange={(event) => update(index, 'rate', event.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    {issue && <p className="mt-1 max-w-52 text-xs text-destructive">{issue}</p>}
                  </td>
                  <td className="py-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove slab"
                      disabled={rows.length === 1}
                      onClick={() => removeRow(index)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button variant="outline" size="sm" className="mt-3" onClick={addRow}>
        <Plus className="h-4 w-4" aria-hidden />
        Add slab
      </Button>

      {!validation.valid && validation.issues.some((issue) => issue.index === -1) && (
        <p className="mt-3 rounded-md bg-warning/15 px-3 py-2 text-sm">
          {validation.issues.find((issue) => issue.index === -1)?.message}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Slabs must start at 1, must not overlap, and must leave no gap. Leave the last
        <span className="font-medium"> To qty </span>
        blank for an open-ended bulk rate.
      </p>

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </Dialog>
  );
}
