import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ShoppingCart } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { useAuthStore } from '@/stores/authStore';
import { formatDate, formatMoney } from '@/lib/format';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { usePurchaseOrders, type PurchaseOrderSummary } from './purchasingApi';
import { NewPurchaseOrderDialog } from './NewPurchaseOrderDialog';

const STATUS_STYLE: Record<PurchaseOrderSummary['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  SENT: { label: 'Sent', variant: 'default' },
  PARTIALLY_RECEIVED: { label: 'Partially received', variant: 'warning' },
  RECEIVED: { label: 'Received', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

export function PurchaseOrdersPage() {
  const canCreate = useHasPermission(PERMISSIONS.PURCHASES_CREATE);
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const [status, setStatus] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const { data, isPending, isError, error, refetch } = usePurchaseOrders({
    branchId: activeBranchId,
    status: status || undefined,
  });

  const orders = data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <LabelledPageHeader
        label={{ en: 'Purchase Orders', hi: 'खरीद ऑर्डर' }}
        description="What has been ordered from suppliers, and what has arrived"
        actions={
          canCreate ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New purchase order
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Select className="w-48" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All orders</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="PARTIALLY_RECEIVED">Partially received</option>
          <option value="RECEIVED">Received</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : 'Could not load purchase orders'} onRetry={() => void refetch()} />
      ) : !isPending && orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No purchase orders yet"
          message="Create your first purchase order to start restocking from a supplier."
          action={canCreate ? <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" aria-hidden />New purchase order</Button> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>Date</TH>
              <TH>Supplier</TH>
              <TH>Branch</TH>
              <TH numeric>Total</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {isPending ? (
              <TableMessage colSpan={6}>Loading purchase orders...</TableMessage>
            ) : (
              orders.map((po) => {
                const style = STATUS_STYLE[po.status];
                return (
                  <TR key={po._id}>
                    <TD>
                      <Link to={`/purchases/${po._id}`} className="font-medium tabular hover:text-primary hover:underline">
                        {po.number}
                      </Link>
                    </TD>
                    <TD className="text-muted-foreground">{formatDate(po.orderDate)}</TD>
                    <TD>{po.supplierName}</TD>
                    <TD>{po.branchName}</TD>
                    <TD numeric>{formatMoney(po.totalPaise)}</TD>
                    <TD>
                      <Badge variant={style.variant}>{style.label}</Badge>
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      )}

      <NewPurchaseOrderDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
