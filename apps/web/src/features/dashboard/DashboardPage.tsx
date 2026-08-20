import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Package,
  TriangleAlert,
  Warehouse,
} from 'lucide-react';
import { formatNumber, formatRelative } from '@/lib/format';
import { api, toQuery } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { MOVEMENT_LABELS } from '@/lib/labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { formatTierRange } from '@shopos/shared';
import { formatMoney } from '@/lib/format';

/**
 * The opening screen.
 *
 * Answers the three questions a shop owner opens the software to ask: how much
 * stock do I have, what is about to run out, and what have my staff been doing.
 * Sales figures join this once invoicing lands.
 */

interface DashboardData {
  productCount: number;
  branchCount: number;
  stock: {
    totalUnits: number;
    stockedProducts: number;
    lowStockCount: number;
    allowNegativeStock: boolean;
  };
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
  recentActivity: {
    _id: string;
    action: string;
    entityLabel?: string;
    userName: string;
    createdAt: string;
  }[];
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  to,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  hint?: string;
  tone?: 'warning';
  to?: string;
}) {
  const body = (
    <Card className={tone === 'warning' ? 'border-warning/50' : undefined}>
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={
            tone === 'warning'
              ? 'flex h-10 w-10 items-center justify-center rounded-lg bg-warning/20 text-warning-foreground'
              : 'flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground'
          }
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );

  return to ? (
    <Link to={to} className="block transition-opacity hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
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
      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle="नमस्ते"
        description={session?.organization.name}
      />

      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Could not load the dashboard'}
          onRetry={() => void refetch()}
        />
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Package}
              label="Products"
              value={formatNumber(data.productCount)}
              hint="in the catalogue"
              to="/products"
            />
            <StatCard
              icon={Warehouse}
              label="Total units in stock"
              value={formatNumber(data.stock.totalUnits)}
              hint={`${formatNumber(data.stock.stockedProducts)} product lines`}
              to="/stock"
            />
            <StatCard
              icon={TriangleAlert}
              label="Running low"
              value={formatNumber(data.stock.lowStockCount)}
              hint="at or below reorder level"
              {...(data.stock.lowStockCount > 0 ? { tone: 'warning' as const } : {})}
              to="/stock?low=1"
            />
            <StatCard
              icon={Building2}
              label="Branches"
              value={formatNumber(data.branchCount)}
              hint="holding stock"
              to="/admin/branches"
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent stock movement</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentMovements.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No stock has moved yet.
                  </p>
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
                                ? 'flex h-7 w-7 items-center justify-center rounded-full bg-success/15 text-success'
                                : 'flex h-7 w-7 items-center justify-center rounded-full bg-destructive/15 text-destructive'
                            }
                          >
                            {inbound ? (
                              <ArrowUpRight className="h-4 w-4" aria-hidden />
                            ) : (
                              <ArrowDownRight className="h-4 w-4" aria-hidden />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{movement.productName}</p>
                            <p className="text-xs text-muted-foreground">
                              {label?.en ?? movement.type} by {movement.performedByName} -{' '}
                              {formatRelative(movement.occurredAt)}
                            </p>
                          </div>
                          <span
                            className={
                              inbound
                                ? 'text-sm font-semibold tabular text-success'
                                : 'text-sm font-semibold tabular text-destructive'
                            }
                          >
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
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No rates have been changed yet.
                  </p>
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
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatRelative(update.updatedAt)}
                        </p>
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
                        <span className="text-muted-foreground">
                          {entry.action.toLowerCase().replace(/_/g, ' ')}
                        </span>{' '}
                        {entry.entityLabel && <span>{entry.entityLabel}</span>}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelative(entry.createdAt)}
                      </span>
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
