import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { formatMoney } from '@/lib/format';
import { useBranches } from '@/hooks/useBranches';
import { useAuthStore } from '@/stores/authStore';
import { Field, Select } from '@/components/ui/field';
import { useCustomers, type Customer } from '../customers/customersApi';
import { InvoiceLinePicker, type DocumentTotals, type DraftLine } from './InvoiceLinePicker';

/**
 * The part every sales document shares: where, for whom, at which rate, and which
 * lines. An invoice, a quotation and a sales order differ only in the extra fields
 * around this, so the form lives here once.
 */

interface PriceListOption {
  _id: string;
  name: string;
  isDefault: boolean;
}

const NO_TOTALS: DocumentTotals = { discountPaise: 0, subtotalPaise: 0, taxPaise: 0, totalPaise: 0 };

export function useDocumentForm(open: boolean) {
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
  const [totals, setTotals] = useState<DocumentTotals>(NO_TOTALS);

  useEffect(() => {
    if (!open) return;
    setBranchId(activeBranchId ?? branches?.[0]?._id ?? '');
    setCustomerId('');
    setPriceListId(priceLists?.find((list) => list.isDefault)?._id ?? priceLists?.[0]?._id ?? '');
    setLines([]);
    setTotals(NO_TOTALS);
  }, [open, activeBranchId, branches, priceLists]);

  const customer: Customer | undefined = customers?.find((c) => c._id === customerId);

  // A regular buyer defaults to the rate they usually get, so staff do not have to
  // remember which list a customer is on.
  function chooseCustomer(id: string) {
    setCustomerId(id);
    const chosen = customers?.find((c) => c._id === id);
    if (chosen?.defaultPriceListId) setPriceListId(chosen.defaultPriceListId);
  }

  const ready =
    Boolean(branchId && priceListId) &&
    lines.length > 0 &&
    lines.every((line) => Number(line.quantity) > 0);

  return {
    branches,
    customers,
    priceLists,
    branchId,
    setBranchId,
    customerId,
    chooseCustomer,
    customer,
    priceListId,
    setPriceListId,
    lines,
    setLines,
    totals,
    setTotals,
    ready,
  };
}

export type DocumentFormState = ReturnType<typeof useDocumentForm>;

/** The input shape every sales endpoint takes for its lines. */
export function linesToInput(form: DocumentFormState) {
  return form.lines.map((line) => ({
    productId: line.product._id,
    quantity: Number(line.quantity),
    priceListId: form.priceListId,
    ...(Number(line.discountPercent) > 0 ? { discountPercent: Number(line.discountPercent) } : {}),
  }));
}

export function DocumentFields({ form, extra }: { form: DocumentFormState; extra?: ReactNode }) {
  return (
    <>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label="Branch" required>
          <Select value={form.branchId} onChange={(event) => form.setBranchId(event.target.value)}>
            <option value="">Select</option>
            {form.branches?.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Customer" hint="Leave blank for a walk-in sale">
          <Select value={form.customerId} onChange={(event) => form.chooseCustomer(event.target.value)}>
            <option value="">Walk-in customer</option>
            {form.customers?.map((customer) => (
              <option key={customer._id} value={customer._id}>
                {customer.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rate type" required>
          <Select value={form.priceListId} onChange={(event) => form.setPriceListId(event.target.value)}>
            <option value="">Select</option>
            {form.priceLists?.map((list) => (
              <option key={list._id} value={list._id}>
                {list.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {extra}

      <InvoiceLinePicker
        lines={form.lines}
        onChange={form.setLines}
        priceListId={form.priceListId}
        onTotalsChange={form.setTotals}
      />
    </>
  );
}

export function TotalsPanel({ totals }: { totals: DocumentTotals }) {
  if (totals.totalPaise === 0) return null;

  return (
    <div className="mt-4 flex justify-end">
      <div className="w-64 space-y-1 rounded-md bg-muted/60 px-4 py-3 text-sm">
        {totals.discountPaise > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Discount given</span>
            <span className="tabular">{formatMoney(totals.discountPaise)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular">{formatMoney(totals.subtotalPaise)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax</span>
          <span className="tabular">{formatMoney(totals.taxPaise)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
          <span>Total</span>
          <span className="tabular">{formatMoney(totals.totalPaise)}</span>
        </div>
      </div>
    </div>
  );
}
