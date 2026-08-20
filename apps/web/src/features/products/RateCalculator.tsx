import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator } from 'lucide-react';
import { api, ApiRequestError, toQuery } from '@/lib/apiClient';
import { formatMoney, formatNumber } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/field';
import type { ProductRateCard } from './productsApi';

/**
 * "How much for a hundred?"
 *
 * This is the question ShopOS exists to answer, so it sits at the top of the
 * product page rather than behind a menu. A staff member types the quantity a
 * customer asked for and reads back the rate and the total.
 *
 * The answer comes from the SERVER, not from the slabs already on screen. The
 * client could work it out - the same function is available to it - but then two
 * different pieces of code would decide prices, and one day they would disagree.
 * One authority, always the server.
 */

interface ResolvedPrice {
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  priceListName: string;
  appliedTier: { range: string; minQuantity: number; maxQuantity: number | null };
}

export function RateCalculator({
  productId,
  unitSymbol,
  rateCards,
}: {
  productId: string;
  unitSymbol: string;
  rateCards: ProductRateCard[];
}) {
  const withRates = rateCards.filter((card) => card.tiers.length > 0);
  const [priceListId, setPriceListId] = useState(
    withRates.find((card) => card.isDefault)?.priceListId ?? withRates[0]?.priceListId ?? '',
  );
  const [quantity, setQuantity] = useState('1');

  const parsedQuantity = Number(quantity);
  const enabled = Boolean(priceListId) && Number.isFinite(parsedQuantity) && parsedQuantity > 0;

  const { data, isFetching, error } = useQuery({
    queryKey: ['price-resolve', productId, priceListId, parsedQuantity],
    queryFn: () =>
      api.get<ResolvedPrice>(
        `/pricing/resolve${toQuery({ productId, priceListId, quantity: parsedQuantity })}`,
      ),
    enabled,
    retry: false,
  });

  if (withRates.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-5 text-sm text-muted-foreground">
          No rates have been set for this product yet. Add a rate card below and the calculator will
          work.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">What is the rate?</h2>
          <span className="text-xs text-muted-foreground">भाव क्या है?</span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground" htmlFor="calc-qty">
              Quantity
            </label>
            <Input
              id="calc-qty"
              type="number"
              min={1}
              className="h-11 w-32 text-lg tabular"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground" htmlFor="calc-list">
              Rate type
            </label>
            <Select
              id="calc-list"
              className="h-11 w-44"
              value={priceListId}
              onChange={(event) => setPriceListId(event.target.value)}
            >
              {withRates.map((card) => (
                <option key={card.priceListId} value={card.priceListId}>
                  {card.priceListName}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-48 flex-1 rounded-md bg-muted/60 px-4 py-2.5">
            {error ? (
              <p className="text-sm text-destructive">
                {error instanceof ApiRequestError ? error.message : 'Could not work out the rate'}
              </p>
            ) : !enabled ? (
              <p className="text-sm text-muted-foreground">Enter a quantity</p>
            ) : isFetching || !data ? (
              <p className="text-sm text-muted-foreground">Checking...</p>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <div>
                  <p className="text-xs text-muted-foreground">Rate per {unitSymbol}</p>
                  <p className="text-xl font-semibold tabular">
                    {formatMoney(data.unitPricePaise)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Total for {formatNumber(data.quantity)} {unitSymbol}
                  </p>
                  <p className="text-xl font-semibold tabular text-primary">
                    {formatMoney(data.lineTotalPaise)}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Slab {data.appliedTier.range}
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
