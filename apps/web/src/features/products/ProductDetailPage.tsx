import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Archive, ArchiveRestore, Pencil, Tags } from 'lucide-react';
import { PERMISSIONS, formatTierRange } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { formatDateTime, formatMoney, formatNumber, formatRelative } from '@/lib/format';
import { priceListSubtitle } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useArchiveProduct, useProduct, type ProductRateCard } from './productsApi';
import { ProductFormDialog } from './ProductFormDialog';
import { RateCardDialog } from './RateCardDialog';
import { RateCalculator } from './RateCalculator';

/**
 * One product, everything about it.
 *
 * This is the screen that replaces the phone call to the owner. It answers every
 * question at once - what it costs at each rate type, what a given quantity
 * works out to, and how many are at each branch - rather than making a staff
 * member click through tabs while a customer waits.
 */

function RateCard({
  card,
  canEdit,
  onEdit,
}: {
  card: ProductRateCard;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const subtitle = priceListSubtitle(card.priceListCode);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            {card.priceListName}
            {card.isDefault && <Badge variant="outline">Default</Badge>}
          </CardTitle>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {card.tiers.length > 0 ? 'Edit' : 'Set rate'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {card.tiers.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No rate set.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <tbody>
                {card.tiers.map((tier) => (
                  <tr key={tier.minQuantity} className="border-b border-border last:border-b-0">
                    <td className="py-1.5 text-muted-foreground tabular">
                      {formatTierRange(tier)}
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular">
                      {formatMoney(tier.pricePaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {card.updatedAt && (
              <p className="mt-3 text-xs text-muted-foreground">
                Updated {formatRelative(card.updatedAt)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canEditProduct = useHasPermission(PERMISSIONS.PRODUCTS_UPDATE);
  const canArchive = useHasPermission(PERMISSIONS.PRODUCTS_ARCHIVE);
  const canEditRates = useHasPermission(PERMISSIONS.PRICING_UPDATE);
  const canSeeRates = useHasPermission(PERMISSIONS.PRICING_VIEW);

  const { data, isPending, isError, error, refetch } = useProduct(id);
  const archive = useArchiveProduct(id ?? '');

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [rateCard, setRateCard] = useState<ProductRateCard | null>(null);

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl">
        <ErrorState
          message={error instanceof Error ? error.message : 'Could not load this product'}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (isPending || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28" />
        <Skeleton className="h-52" />
      </div>
    );
  }

  const { product, prices, stock, totalStock } = data;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to="/products"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All products
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{product.name}</h1>
            {!product.isActive && <Badge variant="outline">Archived</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <span className="tabular">Item code {product.sku}</span>
            {product.brandName && <span>{product.brandName}</span>}
            {product.categoryName && <span>{product.categoryName}</span>}
            <span>
              Sold by {product.unitName} ({product.unitSymbol})
            </span>
            {product.barcodes.length > 0 && (
              <span className="tabular">Barcode {product.barcodes[0]?.code}</span>
            )}
          </p>
        </div>

        <div className="flex gap-2">
          {canEditProduct && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Button>
          )}
          {canArchive && (
            <Button variant="outline" onClick={() => setArchiveOpen(true)}>
              {product.isActive ? (
                <>
                  <Archive className="h-4 w-4" aria-hidden />
                  Archive
                </>
              ) : (
                <>
                  <ArchiveRestore className="h-4 w-4" aria-hidden />
                  Restore
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {canSeeRates && (
        <div className="mb-6">
          <RateCalculator
            productId={product._id}
            unitSymbol={product.unitSymbol}
            rateCards={prices}
          />
        </div>
      )}

      {canSeeRates && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Tags className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">Rate cards</h2>
            <span className="text-xs text-muted-foreground">भाव सूची</span>
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {prices.map((card) => (
              <RateCard
                key={card.priceListId}
                card={card}
                canEdit={canEditRates}
                onEdit={() => setRateCard(card)}
              />
            ))}
          </div>
        </>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Stock by branch</h2>
          <span className="text-xs text-muted-foreground">शाखा अनुसार स्टॉक</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Total{' '}
          <span className="font-semibold tabular text-foreground">
            {formatNumber(totalStock)} {product.unitSymbol}
          </span>
        </p>
      </div>

      {stock.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No stock recorded at any branch yet.
          </CardContent>
        </Card>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Branch</TH>
              <TH numeric>Quantity</TH>
              <TH>Last movement</TH>
            </TR>
          </THead>
          <TBody>
            {stock.map((row) => {
              const low = product.reorderLevel > 0 && row.quantity <= product.reorderLevel;
              return (
                <TR key={row.branchId}>
                  <TD className="font-medium">{row.branchName}</TD>
                  <TD numeric>
                    <span className={low ? 'font-semibold text-destructive' : ''}>
                      {formatNumber(row.quantity)} {product.unitSymbol}
                    </span>
                    {low && (
                      <Badge variant="warning" className="ml-2">
                        Low
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-muted-foreground">{formatDateTime(row.lastMovementAt)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <ProductFormDialog open={editOpen} onOpenChange={setEditOpen} existing={product} />

      {rateCard && (
        <RateCardDialog
          open
          onOpenChange={(open) => !open && setRateCard(null)}
          productId={product._id}
          productName={product.name}
          priceListId={rateCard.priceListId}
          priceListName={rateCard.priceListName}
          initialTiers={rateCard.tiers}
        />
      )}

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={product.isActive ? 'Archive this product?' : 'Restore this product?'}
        message={
          product.isActive
            ? 'It will be hidden from searches and new work. Past stock movements and rates are kept, and you can restore it at any time.'
            : 'It will appear in searches again and can be sold and stocked as before.'
        }
        confirmLabel={product.isActive ? 'Archive' : 'Restore'}
        destructive={product.isActive}
        busy={archive.isPending}
        onConfirm={() => {
          archive.mutate(!product.isActive, { onSuccess: () => setArchiveOpen(false) });
        }}
      />
    </div>
  );
}
