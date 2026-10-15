import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { formatDate, formatMoney } from '@/lib/format';
import { LABELS } from '@/lib/labels';
import { SALES_ORDER_STATUS, statusOf } from '@/lib/statusStyles';
import { Badge } from '@/components/ui/badge';
import { DocumentList } from '@/components/DocumentList';
import { NewSalesOrderDialog } from './NewSalesOrderDialog';
import { useSalesOrders, type SalesOrderSummary } from './salesOrdersApi';

export function SalesOrdersPage() {
  const canCreate = useHasPermission(PERMISSIONS.SALES_CREATE);
  const [newOpen, setNewOpen] = useState(false);

  return (
    <DocumentList<SalesOrderSummary>
      label={LABELS.salesOrders}
      description="Promises to supply - billed in parts as the goods go out"
      newLabel="New order"
      canCreate={canCreate}
      onNew={() => setNewOpen(true)}
      statusOptions={Object.entries(SALES_ORDER_STATUS).map(([value, style]) => ({ value, label: style.label }))}
      searchPlaceholder="Order no. or customer"
      useRows={useSalesOrders}
      icon={ClipboardList}
      emptyMessage="Take an order for goods you will supply and invoice over time."
      rowLink={(row) => `/sales-orders/${row._id}`}
      columns={[
        { header: 'Number', cell: (row) => row.number },
        { header: 'Date', cell: (row) => formatDate(row.orderDate) },
        { header: 'Customer', cell: (row) => row.customerName },
        { header: 'Branch', cell: (row) => row.branchName },
        { header: 'Wanted by', cell: (row) => (row.expectedDate ? formatDate(row.expectedDate) : '-') },
        { header: 'Total', numeric: true, cell: (row) => formatMoney(row.totalPaise) },
        {
          header: 'Status',
          cell: (row) => {
            const style = statusOf(SALES_ORDER_STATUS, row.status);
            return <Badge variant={style.variant}>{style.label}</Badge>;
          },
        },
      ]}
      dialog={<NewSalesOrderDialog open={newOpen} onOpenChange={setNewOpen} />}
    />
  );
}
