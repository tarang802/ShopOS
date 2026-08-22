import { useEffect, useState } from 'react';
import { Plus, Search, Truck } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { ApiRequestError } from '@/lib/apiClient';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';
import { useCreateSupplier, useSuppliers, type SupplierInput } from './purchasingApi';

/**
 * Suppliers.
 *
 * Mirrors the customer list - a supplier is who a purchase order is placed
 * with, so it exists to be picked from a dropdown, not to be a CRM.
 */

function AddSupplierDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateSupplier();
  const [form, setForm] = useState<SupplierInput>({ name: '', phone: '', city: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ name: '', phone: '', city: '' });
      setError(null);
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add supplier"
      description="सप्लायर जोड़ें"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              create.mutate(form, {
                onSuccess: () => onOpenChange(false),
                onError: (cause) =>
                  setError(cause instanceof ApiRequestError ? cause.message : 'Could not add the supplier'),
              })
            }
            disabled={!form.name.trim() || create.isPending}
          >
            {create.isPending ? 'Saving...' : 'Add supplier'}
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <Input
          value={form.name}
          onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
          placeholder="Sharma Wholesale Traders"
          autoFocus
        />
      </Field>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Phone">
          <Input
            value={form.phone ?? ''}
            onChange={(event) => setForm((c) => ({ ...c, phone: event.target.value }))}
          />
        </Field>
        <Field label="City">
          <Input
            value={form.city ?? ''}
            onChange={(event) => setForm((c) => ({ ...c, city: event.target.value }))}
          />
        </Field>
      </div>
      <Field label="GSTIN">
        <Input
          value={form.gstin ?? ''}
          onChange={(event) => setForm((c) => ({ ...c, gstin: event.target.value.toUpperCase() }))}
        />
      </Field>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}

export function SuppliersPage() {
  const canManage = useHasPermission(PERMISSIONS.SUPPLIERS_MANAGE);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: suppliers, isPending } = useSuppliers(debounced);

  return (
    <div className="mx-auto max-w-4xl">
      <LabelledPageHeader
        label={{ en: 'Suppliers', hi: 'सप्लायर' }}
        description="Who you buy from"
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
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by name or phone"
          className="pl-9"
        />
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
              <TH>GSTIN</TH>
            </TR>
          </THead>
          <TBody>
            {isPending ? (
              <TableMessage colSpan={4}>Loading suppliers...</TableMessage>
            ) : (
              suppliers?.map((supplier) => (
                <TR key={supplier._id}>
                  <TD className="font-medium">{supplier.name}</TD>
                  <TD className="tabular">{supplier.phone ?? '-'}</TD>
                  <TD>{supplier.city ?? '-'}</TD>
                  <TD className="tabular text-muted-foreground">{supplier.gstin ?? '-'}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      )}

      <AddSupplierDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
