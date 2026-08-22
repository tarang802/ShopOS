import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { ApiRequestError } from '@/lib/apiClient';
import { formatMoney } from '@/lib/format';
import { useBranches } from '@/hooks/useBranches';
import { useAuthStore } from '@/stores/authStore';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { useCustomers } from '../customers/customersApi';
import { InvoiceLinePicker, type DraftLine } from './InvoiceLinePicker';
import { useCreateInvoice } from './invoicesApi';

interface PriceListOption {
  _id: string;
  name: string;
  isDefault: boolean;
}

export function NewInvoiceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const { data: branches } = useBranches();
  const { data: customers } = useCustomers();
  const { data: priceLists } = useQuery({
    queryKey: ['price-lists'],
    queryFn: () => api.get<PriceListOption[]>('/pricing/lists'),
    staleTime: 5 * 60_000,
  });

  const [branchId, setBranchId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [priceListId, setPriceListId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [subtotalPaise, setSubtotalPaise] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const createInvoice = useCreateInvoice();

  useEffect(() => {
    if (!open) return;
    setBranchId(activeBranchId ?? branches?.[0]?._id ?? '');
    setCustomerId('');
    setPriceListId(priceLists?.find((list) => list.isDefault)?._id ?? priceLists?.[0]?._id ?? '');
    setLines([]);
    setSubtotalPaise(0);
    setError(null);
  }, [open, activeBranchId, branches, priceLists]);

  const ready = branchId && priceListId && lines.length > 0 && lines.every((line) => Number(line.quantity) > 0);

  function submit() {
    setError(null);
    createInvoice.mutate(
      {
        branchId,
        ...(customerId ? { customerId } : {}),
        items: lines.map((line) => ({
          productId: line.product._id,
          quantity: Number(line.quantity),
          priceListId,
        })),
      },
      {
        onSuccess: (invoice) => {
          onOpenChange(false);
          navigate(`/sales/${invoice._id}`);
        },
        onError: (cause) =>
          setError(cause instanceof ApiRequestError ? cause.message : 'Could not create the invoice'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="New invoice"
      description="नया बिल"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createInvoice.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || createInvoice.isPending}>
            {createInvoice.isPending ? 'Creating...' : 'Create invoice'}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label="Branch" required>
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">Select</option>
            {branches?.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Customer" hint="Leave blank for a walk-in sale">
          <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">Walk-in customer</option>
            {customers?.map((customer) => (
              <option key={customer._id} value={customer._id}>
                {customer.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rate type" required>
          <Select value={priceListId} onChange={(event) => setPriceListId(event.target.value)}>
            <option value="">Select</option>
            {priceLists?.map((list) => (
              <option key={list._id} value={list._id}>
                {list.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <InvoiceLinePicker
        lines={lines}
        onChange={setLines}
        priceListId={priceListId}
        onTotalsChange={setSubtotalPaise}
      />

      {lines.length > 0 && (
        <div className="mt-4 flex justify-end">
          <div className="w-56 rounded-md bg-muted/60 px-4 py-2.5 text-right">
            <p className="text-xs text-muted-foreground">Subtotal (before tax)</p>
            <p className="text-lg font-semibold tabular">{formatMoney(subtotalPaise)}</p>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}
