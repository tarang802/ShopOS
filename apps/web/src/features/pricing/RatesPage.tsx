import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Tags } from 'lucide-react';
import { PERMISSIONS, formatTierRange, type PriceTier } from '@shopos/shared';
import { api, ApiRequestError } from '@/lib/apiClient';
import { useHasPermission } from '@/stores/authStore';
import { LABELS, priceListSubtitle } from '@/lib/labels';
import { formatMoney, formatRelative } from '@/lib/format';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useProducts } from '../products/productsApi';
import { RateCardDialog } from '../products/RateCardDialog';

/**
 * Rates across the whole catalogue.
 *
 * The product page answers "what does this cost". This page answers the other
 * question an owner has: "what am I charging for everything, and where have I
 * forgotten to set a rate". Products with no rate under the selected list are
 * called out, because an unpriced product is the thing that generates the phone
 * call this software is meant to remove.
 */

interface PriceListRecord {
  _id: string;
  name: string;
  code: string;
  description?: string;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
}

interface ProductRateRow {
  productId: string;
  productName: string;
  sku: string;
  unitSymbol: string;
  tiers: PriceTier[];
  updatedAt: string | null;
}

function usePriceLists() {
  return useQuery({
    queryKey: ['price-lists'],
    queryFn: () => api.get<PriceListRecord[]>('/pricing/lists'),
    staleTime: 5 * 60_000,
  });
}

function NewPriceListDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setCode('');
      setError(null);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: (body: { name: string; code: string }) => api.post('/pricing/lists', body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['price-lists'] });
      onOpenChange(false);
    },
    onError: (cause) =>
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not create the rate list'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New rate type"
      description="For example a staff rate, or an institution rate"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              create.mutate({
                name: name.trim(),
                code: code.trim() || name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
              })
            }
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? 'Creating...' : 'Create'}
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Institution rate"
          autoFocus
        />
      </Field>
      <Field label="Short code" hint="Left blank, one is made from the name">
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="INSTITUTION"
        />
      </Field>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}

export function RatesPage() {
  const canEdit = useHasPermission(PERMISSIONS.PRICING_UPDATE);
  const canCreateList = useHasPermission(PERMISSIONS.PRICING_CREATE);

  const { data: lists, isPending: listsPending } = usePriceLists();
  const [selectedListId, setSelectedListId] = useState('');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [newListOpen, setNewListOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRateRow | null>(null);

  useEffect(() => {
    if (!selectedListId && lists && lists.length > 0) {
      setSelectedListId(lists.find((list) => list.isDefault)?._id ?? lists[0]!._id);
    }
  }, [lists, selectedListId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: products, isPending, isError, error, refetch } = useProducts({
    search: debounced,
    limit: 25,
  });

  /**
   * The rate for each listed product under the chosen list.
   *
   * Fetched per visible page rather than for the whole catalogue - twenty-five
   * detail calls for twenty-five visible rows, never twelve thousand.
   */
  const productIds = (products?.items ?? []).map((product) => product._id);
  const { data: rates } = useQuery({
    queryKey: ['rates-overview', selectedListId, productIds],
    enabled: Boolean(selectedListId) && productIds.length > 0,
    queryFn: async () => {
      const details = await Promise.all(
        productIds.map((productId) =>
          api.get<{
            product: { _id: string; name: string; sku: string; unitSymbol: string };
            prices: { priceListId: string; tiers: PriceTier[]; updatedAt: string | null }[];
          }>(`/products/${productId}`),
        ),
      );

      const rows: ProductRateRow[] = details.map((detail) => {
        const card = detail.prices.find((price) => price.priceListId === selectedListId);
        return {
          productId: detail.product._id,
          productName: detail.product.name,
          sku: detail.product.sku,
          unitSymbol: detail.product.unitSymbol,
          tiers: card?.tiers ?? [],
          updatedAt: card?.updatedAt ?? null,
        };
      });
      return rows;
    },
  });

  const selectedList = lists?.find((list) => list._id === selectedListId);

  return (
    <div className="mx-auto max-w-6xl">
      <LabelledPageHeader
        label={LABELS.rates}
        description="Retail, wholesale and dealer rates for everything you sell"
        actions={
          canCreateList ? (
            <Button variant="outline" onClick={() => setNewListOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New rate type
            </Button>
          ) : undefined
        }
      />

      {listsPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading rate types...</p>
      ) : !lists || lists.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No rate types"
          message="Create a rate type to start pricing your products."
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((list) => {
              const active = list._id === selectedListId;
              const subtitle = priceListSubtitle(list.code);
              return (
                <button key={list._id} type="button" onClick={() => setSelectedListId(list._id)}>
                  <Card
                    className={
                      active
                        ? 'border-primary bg-accent/40 text-left transition-colors'
                        : 'text-left transition-colors hover:border-muted-foreground/40'
                    }
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{list.name}</span>
                        {list.isDefault && <Badge variant="outline">Default</Badge>}
                      </div>
                      {subtitle && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
                      )}
                      {list.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{list.description}</p>
                      )}
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>

          <div className="mb-4 relative max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search a product"
              className="pl-9"
              aria-label="Search products"
            />
          </div>

          {isError ? (
            <ErrorState
              message={error instanceof Error ? error.message : 'Could not load products'}
              onRetry={() => void refetch()}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>{selectedList?.name ?? 'Rate'} slabs</TH>
                  <TH>Updated</TH>
                  {canEdit && <TH />}
                </TR>
              </THead>
              <TBody>
                {isPending ? (
                  <TableMessage colSpan={4}>Loading...</TableMessage>
                ) : (rates ?? []).length === 0 ? (
                  <TableMessage colSpan={4}>No products found.</TableMessage>
                ) : (
                  (rates ?? []).map((row) => (
                    <TR key={row.productId}>
                      <TD>
                        <Link
                          to={`/products/${row.productId}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {row.productName}
                        </Link>
                        <span className="block text-xs text-muted-foreground tabular">
                          {row.sku}
                        </span>
                      </TD>
                      <TD>
                        {row.tiers.length === 0 ? (
                          <Badge variant="warning">No rate set</Badge>
                        ) : (
                          <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular">
                            {row.tiers.map((tier) => (
                              <span key={tier.minQuantity}>
                                <span className="text-muted-foreground">
                                  {formatTierRange(tier)}
                                </span>{' '}
                                <span className="font-medium">{formatMoney(tier.pricePaise)}</span>
                              </span>
                            ))}
                          </span>
                        )}
                      </TD>
                      <TD className="text-muted-foreground">
                        {row.updatedAt ? formatRelative(row.updatedAt) : '-'}
                      </TD>
                      {canEdit && (
                        <TD>
                          <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                            {row.tiers.length > 0 ? 'Edit' : 'Set rate'}
                          </Button>
                        </TD>
                      )}
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          )}
        </>
      )}

      <NewPriceListDialog open={newListOpen} onOpenChange={setNewListOpen} />

      {editing && selectedList && (
        <RateCardDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          productId={editing.productId}
          productName={editing.productName}
          priceListId={selectedList._id}
          priceListName={selectedList.name}
          initialTiers={editing.tiers}
        />
      )}
    </div>
  );
}
