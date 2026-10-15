import { useState } from 'react';
import { FileText } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { formatDate, formatMoney } from '@/lib/format';
import { LABELS } from '@/lib/labels';
import { QUOTATION_STATUS, statusOf } from '@/lib/statusStyles';
import { Badge } from '@/components/ui/badge';
import { DocumentList } from '@/components/DocumentList';
import { NewQuotationDialog } from './NewQuotationDialog';
import { useQuotations, type QuotationSummary } from './quotationsApi';

export function QuotationsPage() {
  const canCreate = useHasPermission(PERMISSIONS.SALES_CREATE);
  const [newOpen, setNewOpen] = useState(false);

  return (
    <DocumentList<QuotationSummary>
      label={LABELS.quotations}
      description="Offers with a price and an expiry - nothing moves until one is accepted and billed"
      newLabel="New quotation"
      canCreate={canCreate}
      onNew={() => setNewOpen(true)}
      statusOptions={Object.entries(QUOTATION_STATUS).map(([value, style]) => ({ value, label: style.label }))}
      searchPlaceholder="Quotation no. or customer"
      useRows={useQuotations}
      icon={FileText}
      emptyMessage="Write a quotation to give a customer a price they can hold you to."
      rowLink={(row) => `/quotations/${row._id}`}
      columns={[
        { header: 'Number', cell: (row) => row.number },
        { header: 'Date', cell: (row) => formatDate(row.quotationDate) },
        { header: 'Customer', cell: (row) => row.customerName },
        { header: 'Branch', cell: (row) => row.branchName },
        { header: 'Valid until', cell: (row) => formatDate(row.validUntil) },
        { header: 'Total', numeric: true, cell: (row) => formatMoney(row.totalPaise) },
        {
          header: 'Status',
          cell: (row) => {
            const style = statusOf(QUOTATION_STATUS, row.status);
            return <Badge variant={style.variant}>{style.label}</Badge>;
          },
        },
      ]}
      dialog={<NewQuotationDialog open={newOpen} onOpenChange={setNewOpen} />}
    />
  );
}
