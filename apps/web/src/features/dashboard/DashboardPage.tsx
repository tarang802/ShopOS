import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, TriangleAlert } from 'lucide-react';
import { formatTierRange } from '@shopos/shared';
import { api, toQuery } from '@/lib/apiClient';
import { formatMoney, formatNumber, formatRelative } from '@/lib/format';
import { MOVEMENT_LABELS } from '@/lib/labels';
import { useAuthStore } from '@/stores/authStore';
import { PageHeader } from '@/components/PageHeader';
import { StatTile } from '@/components/StatTile';
import { TrendChart, type TrendPoint } from '@/components/TrendChart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/states';

/**
 * The opening screen.
 *
 * Answers what an owner opens the software to ask: how are sales, who owes me, whom do
 * I owe, what is about to run out and what needs doing today. Every block is only sent
 * to people allowed to see its subject, so the screen simply has fewer boxes for someone
 * who handles stock than for someone who handles money.
 */

interface DashboardData {
  productCount: number;
  branchCount: number;
  stock: { totalUnits: number; stockedProducts: number; lowStockCount: number; allowNegativeStock: boolean };
  sales: {
    today: { totalPaise: number; invoices: number };
    yesterday: { totalPaise: number; invoices: number };
    thisMonth: { totalPaise: number; invoices: number; averageBillPaise: number };
    lastMonth: { totalPaise: number; invoices: number };
    trend: (TrendPoint & { invoices: number })[];
  } | null;
  receivables: { outstandingPaise: number; overduePaise: number; openInvoices: number; overdueInvoices: number } | null;
  payables: { owedPaise: number; overduePaise: number; openOrders: number; overdueOrders: number } | null;
  collectedToday: { totalPaise: number; payments: number } | null;
  topProducts: { productId: string; name: string; units: number; netPaise: number }[] | null;
  pending: { openSalesOrders: number; quotationsExpiringSoon: number; purchasesAwaitingDelivery: number } | null;
  lowStock: { count: number; items: { product: string; sku: string; branch: string; quantity: number; reorderLevel: number }[] } | null;
  recentMovements: {
    _id: string;
    type: string;
    productName: string;
    productSku: string;
    quantityDelta: number;
    balanceAfter: number;
    performedByName: string;
    occurredAt: string;
  }[];
  recentPriceUpdates: {
    productName: string;
    sku: string;
    priceListName: string;
    tiers: { minQuantity: number; maxQuantity: number | null; pricePaise: number }[];
    updatedAt: string;
  }[];
  recentActivity: { _id: string; action: string; entityLabel?: string; userName: string; createdAt: string }[];
}

function compare(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? 'nothing yet' : 'nothing to compare';
  const change = ((current - previous) / previous) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(0)}% on ${formatMoney(previous)}`;
}

export function DashboardPage() {
  const session = useAuthStore((state) => state.session);
  const activeBranchId = useAuthStore((state) => state.activeBranchId);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', activeBranchId],
    queryFn: () => api.get<DashboardData>(`/dashboard${toQuery({ branchId: activeBranchId })}`),
  });

  const firstName = session?.user.name.split(' ')[0] ?? '';

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`Welcome back, ${firstName}`} subtitle="नमस्ते" description={session?.organization.name} />

      {isError && (
        <ErrorState message={error instanceof Error ? error.message : 'Could not load the dashboard'} onRetry={() => void refetch()} />
      )}

      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      )}

      {data && (
        <>
          {(data.sales || data.receivables || data.payables) && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.sales && (
                <StatTile
                  label="Sold today"
                  value={formatMoney(data.sales.today.totalPaise)}
                  hint={`${data.sales.today.invoices} bill${data.sales.today.invoices === 1 ? '' : 's'} - ${compare(data.sales.today.totalPaise, data.sales.yesterday.totalPaise)} yesterday`}
                />
              )}
              {data.sales && (
                <StatTile
                  label="Sold this month"
                  value={formatMoney(data.sales.thisMonth.totalPaise)}
                  hint={`${data.sales.thisMonth.invoices} bills - ${compare(data.sales.thisMonth.totalPaise, data.sales.lastMonth.totalPaise)} last month`}
                />
              )}
              {data.receivables && (
                <StatTile
                  label="Owed to you"
                  value={formatMoney(data.receivables.outstandingPaise)}
                  hint={
                    data.receivables.overduePaise > 0
                      ? `${formatMoney(data.receivables.overduePaise)} overdue`
                      : `${data.receivables.openInvoices} open invoices`
                  }
                  {...(data.receivables.overduePaise > 0 ? { tone: 'danger' as const } : {})}
                />
              )}
              {data.payables && (
                <StatTile
                  label="You owe"
                  value={formatMoney(data.payables.owedPaise)}
                  hint={
                    data.payables.overduePaise > 0
                      ? `${formatMoney(data.payables.overduePaise)} overdue`
                      : `${data.payables.openOrders} orders to pay`
                  }
                  {...(data.payables.overduePaise > 0 ? { tone: 'danger' as const } : {})}
                />
              )}
            </div>
          )}

          {data.sales && (
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Sales, last 14 days</CardTitle>
                </CardHeader>
                <CardContent>
                  <TrendChart points={data.sales.trend} />
                  {data.collectedToday && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Collected today: <span className="font-semibold text-foreground tabular">{formatMoney(data.collectedToday.totalPaise)}</span>{' '}
                      in {data.collectedToday.payments} payment{data.collectedToday.payments === 1 ? '' : 's'}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Best sellers, last 30 days</CardTitle>
                </CardHeader>
                <CardContent>
                  {!data.topProducts || data.topProducts.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No sales yet.</p>
                  ) : (
                    <ol className="space-y-2.5">
                      {data.topProducts.map((product, index) => (
                        <li key={product.productId} className="flex items-baseline gap-2 text-sm">
                          <span className="w-4 font-serif text-muted-foreground">{index + 1}.</span>
                          <Link to={`/products/${product.productId}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">
                            {product.name}
                          </Link>
                          <span className="tabular text-muted-foreground">{formatNumber(product.units)}</span>
                          <span className="w-24 text-right font-semibold tabular">{formatMoney(product.netPaise)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {data.lowStock && (
              <Card className={data.lowStock.count > 0 ? 'border-warning' : undefined}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TriangleAlert className="h-4 w-4 text-warning-foreground" aria-hidden />
                    Running low
                    {data.lowStock.count > 0 && <Badge variant="warning">{data.lowStock.count}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.lowStock.items.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">Everything is above its reorder level.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {data.lowStock.items.map((item, index) => (
                        <li key={`${item.sku}-${item.branch}-${index}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                          <span className="min-w-0 truncate">
                            <span className="font-medium">{item.product}</span>
                            <span className="text-muted-foreground"> - {item.branch}</span>
                          </span>
                          <span className="shrink-0 tabular">
                            <span className="font-semibold text-destructive">{formatNumber(item.quantity)}</span>
                            <span className="text-muted-foreground"> of {formatNumber(item.reorderLevel)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {data.lowStock.count > data.lowStock.items.length && (
                    <Link to="/stock?low=1" className="mt-2 block text-sm text-primary hover:underline">
                      See all {data.lowStock.count}
                    </Link>
                  )}
                </CardContent>
              </Card>
            )}

            {data.pending && (
              <Card>
                <CardHeader>
                  <CardTitle>Waiting on you</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y divide-border text-sm">
                    <li className="flex justify-between py-2">
                      <Link to="/sales-orders" className="hover:text-primary hover:underline">Sales orders to deliver and bill</Link>
                      <span className="font-semibold tabular">{data.pending.openSalesOrders}</span>
                    </li>
                    <li className="flex justify-between py-2">
                      <Link to="/quotations" className="hover:text-primary hover:underline">Quotations expiring within 3 days</Link>
                      <span className="font-semibold tabular">{data.pending.quotationsExpiringSoon}</span>
                    </li>
                    <li className="flex justify-between py-2">
                      <Link to="/purchases" className="hover:text-primary hover:underline">Purchase orders awaiting delivery</Link>
                      <span className="font-semibold tabular">{data.pending.purchasesAwaitingDelivery}</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <StatTile label="Products" value={formatNumber(data.productCount)} hint="in the catalogue" />
            <StatTile label="Units in stock" value={formatNumber(data.stock.totalUnits)} hint={`${formatNumber(data.stock.stockedProducts)} product lines`} />
            <StatTile label="Branches" value={formatNumber(data.branchCount)} hint="holding stock" />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent stock movement</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentMovements.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No stock has moved yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recentMovements.map((movement) => {
                      const inbound = movement.quantityDelta > 0;
                      const label = MOVEMENT_LABELS[movement.type];
                      return (
                        <li key={movement._id} className="flex items-center gap-3 py-2.5">
                          <span
                            className={
                              inbound
                                ? 'flex h-7 w-7 items-center justify-center rounded-sm bg-success/15 text-success'
                                : 'flex h-7 w-7 items-center justify-center rounded-sm bg-destructive/15 text-destructive'
                            }
                          >
                            {inbound ? <ArrowUpRight className="h-4 w-4" aria-hidden /> : <ArrowDownRight className="h-4 w-4" aria-hidden />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{movement.productName}</p>
                            <p className="text-xs text-muted-foreground">
                              {label?.en ?? movement.type} by {movement.performedByName} - {formatRelative(movement.occurredAt)}
                            </p>
                          </div>
                          <span className={inbound ? 'text-sm font-semibold tabular text-success' : 'text-sm font-semibold tabular text-destructive'}>
                            {inbound ? '+' : ''}
                            {formatNumber(movement.quantityDelta)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Latest rate changes</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentPriceUpdates.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No rates have been changed yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recentPriceUpdates.map((update, index) => (
                      <li key={`${update.sku}-${index}`} className="py-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium">{update.productName}</p>
                          <Badge variant="outline">{update.priceListName}</Badge>
                        </div>
                        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          {update.tiers.map((tier) => (
                            <span key={tier.minQuantity} className="tabular">
                              {formatTierRange(tier)}: {formatMoney(tier.pricePaise)}
                            </span>
                          ))}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatRelative(update.updatedAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {data.recentActivity.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Who changed what</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {data.recentActivity.map((entry) => (
                    <li key={entry._id} className="flex items-center justify-between gap-3 py-2">
                      <p className="min-w-0 truncate text-sm">
                        <span className="font-medium">{entry.userName}</span>{' '}
                        <span className="text-muted-foreground">{entry.action.toLowerCase().replace(/_/g, ' ')}</span>{' '}
                        {entry.entityLabel && <span>{entry.entityLabel}</span>}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
