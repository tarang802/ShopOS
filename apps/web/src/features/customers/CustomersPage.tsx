import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Users } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { formatMoney } from '@/lib/format';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { CustomerFormDialog } from './CustomerFormDialog';
import { useCustomersWithBalance } from './customersApi';

/**
 * Customers, with what each one owes.
 *
 * A customer is data, never a login - this list exists so an invoice or a payment
 * can be attributed to someone by name, and so the person at the counter can see at
 * a glance who is carrying a balance before they extend more credit.
 */
export function CustomersPage() {
  const canManage = useHasPermission(PERMISSIONS.CUSTOMERS_MANAGE);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: customers, isPending } = useCustomersWithBalance(debounced);
  const showBalance = customers?.some((customer) => customer.outstandingPaise !== undefined) ?? false;

  return (
    <div className="mx-auto max-w-5xl">
      <LabelledPageHeader
        label={{ en: 'Customers', hi: 'ग्राहक' }}
        description="Who you sell to, and what they owe"
        actions={
          canManage ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add customer
            </Button>
          ) : undefined
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by name or phone" className="pl-9" />
      </div>

      {!isPending && (!customers || customers.length === 0) ? (
        <EmptyState icon={Users} title="No customers yet" message="Add your first customer, or add one directly while creating an invoice." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Phone</TH>
              <TH>City</TH>
              <TH numeric>Credit days</TH>
              {showBalance && <TH numeric>Owes</TH>}
            </TR>
          </THead>
          <TBody>
            {isPending ? (
              <TableMessage colSpan={showBalance ? 5 : 4}>Loading customers...</TableMessage>
            ) : (
              customers?.map((customer) => (
                <TR key={customer._id}>
                  <TD>
                    <Link to={`/customers/${customer._id}`} className="font-medium hover:text-primary hover:underline">
                      {customer.name}
                    </Link>
                  </TD>
                  <TD className="tabular">{customer.phone ?? '-'}</TD>
                  <TD>{customer.city ?? '-'}</TD>
                  <TD numeric>{customer.creditDays ?? 0}</TD>
                  {showBalance && (
                    <TD numeric>
                      {(customer.outstandingPaise ?? 0) > 0 ? (
                        <span className="font-semibold text-destructive">{formatMoney(customer.outstandingPaise ?? 0)}</span>
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

      <CustomerFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
