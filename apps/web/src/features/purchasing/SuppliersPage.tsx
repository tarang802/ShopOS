import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Truck } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { formatMoney } from '@/lib/format';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { SupplierFormDialog } from './SupplierFormDialog';
import { useSuppliersWithBalance } from './purchasingApi';

/**
 * Suppliers, with what is owed to each.
 *
 * A supplier is who a purchase order is placed with; the balance beside every name
 * is what the business still has to pay them for goods already received.
 */
export function SuppliersPage() {
  const canManage = useHasPermission(PERMISSIONS.SUPPLIERS_MANAGE);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: suppliers, isPending } = useSuppliersWithBalance(debounced);
  const showBalance = suppliers?.some((supplier) => supplier.owedPaise !== undefined) ?? false;

  return (
    <div className="mx-auto max-w-5xl">
      <LabelledPageHeader
        label={{ en: 'Suppliers', hi: 'सप्लायर' }}
        description="Who you buy from, and what you owe them"
        actions={
          canManage ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add supplier
            </Button>
          ) : undefined
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by name or phone" className="pl-9" />
      </div>

      {!isPending && (!suppliers || suppliers.length === 0) ? (
        <EmptyState icon={Truck} title="No suppliers yet" message="Add your first supplier, or add one directly while creating a purchase order." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Phone</TH>
              <TH>City</TH>
              <TH numeric>Credit days</TH>
              {showBalance && <TH numeric>You owe</TH>}
            </TR>
          </THead>
          <TBody>
            {isPending ? (
              <TableMessage colSpan={showBalance ? 5 : 4}>Loading suppliers...</TableMessage>
            ) : (
              suppliers?.map((supplier) => (
                <TR key={supplier._id}>
                  <TD>
                    <Link to={`/suppliers/${supplier._id}`} className="font-medium hover:text-primary hover:underline">
                      {supplier.name}
                    </Link>
                  </TD>
                  <TD className="tabular">{supplier.phone ?? '-'}</TD>
                  <TD>{supplier.city ?? '-'}</TD>
                  <TD numeric>{supplier.creditDays ?? 0}</TD>
                  {showBalance && (
                    <TD numeric>
                      {(supplier.owedPaise ?? 0) > 0 ? (
                        <span className="font-semibold text-destructive">{formatMoney(supplier.owedPaise ?? 0)}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TD>
                  )}
                </TR>
              ))
            )}
          </TBody>
        </Table>
      )}

      <SupplierFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
