import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, PackageCheck, Send } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useCancelPurchaseOrder, usePurchaseOrder, useSendPurchaseOrder } from './purchasingApi';
import { ReceiveGoodsDialog } from './ReceiveGoodsDialog';

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  SENT: 'default',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'destructive',
};

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canUpdate = useHasPermission(PERMISSIONS.PURCHASES_UPDATE);
  const canReceive = useHasPermission(PERMISSIONS.PURCHASES_RECEIVE);

  const { data: po, isPending, isError, error, refetch } = usePurchaseOrder(id);
  const sendPO = useSendPurchaseOrder();
  const cancelPO = useCancelPurchaseOrder();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : 'Could not load this purchase order'} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (isPending || !po) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const canSend = canUpdate && po.status === 'DRAFT';
  const canReceiveNow = canReceive && (po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED');
  const canCancelNow = canUpdate && po.status !== 'CANCELLED' && po.status !== 'RECEIVED' && po.items.every((item) => item.receivedQty === 0);

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/purchases" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All purchase orders
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight tabular">{po.number}</h1>
            <Badge variant={STATUS_VARIANT[po.status]}>{po.status.replace('_', ' ')}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {po.supplierName} - {po.branchName} - {formatDateTime(po.orderDate)}
          </p>
        </div>
        <div className="flex gap-2">
          {canSend && (
            <Button onClick={() => sendPO.mutate(po._id)} disabled={sendPO.isPending}>
              <Send className="h-4 w-4" aria-hidden />
              {sendPO.isPending ? 'Sending...' : 'Send to supplier'}
            </Button>
          )}
          {canReceiveNow && (
            <Button onClick={() => setReceiveOpen(true)}>
              <PackageCheck className="h-4 w-4" aria-hidden />
              Receive goods
            </Button>
          )}
          {canCancelNow && (
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              <Ban className="h-4 w-4" aria-hidden />
              Cancel order
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ordered</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Received</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rate</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line total</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((item, index) => (
                <tr key={index} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">{item.productName}</span>
                    <span className="text-xs text-muted-foreground tabular">{item.sku}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {formatNumber(item.orderedQty)} {item.unitSymbol}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {item.receivedQty === item.orderedQty ? (
                      <span className="text-success">{formatNumber(item.receivedQty)}</span>
                    ) : (
                      formatNumber(item.receivedQty)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{formatMoney(item.unitPricePaise)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular">{formatMoney(item.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end border-t border-border p-4">
            <div className="w-56 space-y-1.5 text-sm">
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                <span>Total</span>
                <span className="tabular">{formatMoney(po.totalPaise)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {po.receipts.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Goods receipts</h2>
            <ul className="space-y-3">
              {po.receipts.map((receipt) => (
                <li key={receipt._id} className="text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium tabular">{receipt.number}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(receipt.receivedDate)} - {receipt.receivedByName}
                    </span>
                  </div>
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {receipt.items.map((item, index) => (
                      <li key={index}>
                        {item.productName}: {formatNumber(item.receivedQty)} {item.unitSymbol}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">Created by {po.createdByName}</p>

      <ReceiveGoodsDialog open={receiveOpen} onOpenChange={setReceiveOpen} purchaseOrder={po} />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this purchase order?"
        message="This cannot be undone."
        confirmLabel="Cancel order"
        destructive
        busy={cancelPO.isPending}
        onConfirm={() => {
          cancelPO.mutate(po._id, { onSuccess: () => setCancelOpen(false) });
        }}
      />
    </div>
  );
}
