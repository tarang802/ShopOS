import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/lib/apiClient';
import { formatMoney, parseRupeeInput } from '@/lib/format';
import { useBranches } from '@/hooks/useBranches';
import { useAuthStore } from '@/stores/authStore';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { useCreatePurchaseOrder, useSuppliers } from './purchasingApi';
import { PurchaseOrderLinePicker, type DraftPOLine } from './PurchaseOrderLinePicker';

export function NewPurchaseOrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const { data: branches } = useBranches();
  const { data: suppliers } = useSuppliers();

  const [branchId, setBranchId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<DraftPOLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const createPO = useCreatePurchaseOrder();

  useEffect(() => {
    if (!open) return;
    setBranchId(activeBranchId ?? branches?.[0]?._id ?? '');
    setSupplierId('');
    setLines([]);
    setError(null);
  }, [open, activeBranchId, branches]);

  const ready =
    branchId &&
    supplierId &&
    lines.length > 0 &&
    lines.every((line) => Number(line.quantity) > 0 && parseRupeeInput(line.unitPrice) > 0);

  const totalPaise = lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * parseRupeeInput(line.unitPrice),
    0,
  );

  function submit() {
    setError(null);
    createPO.mutate(
      {
        branchId,
        supplierId,
        items: lines.map((line) => ({
          productId: line.product._id,
          orderedQty: Number(line.quantity),
          unitPricePaise: parseRupeeInput(line.unitPrice),
        })),
      },
      {
        onSuccess: (po) => {
          onOpenChange(false);
          navigate(`/purchases/${po._id}`);
        },
        onError: (cause) =>
          setError(cause instanceof ApiRequestError ? cause.message : 'Could not create the purchase order'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="New purchase order"
      description="नया खरीद ऑर्डर"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createPO.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || createPO.isPending}>
            {createPO.isPending ? 'Creating...' : 'Create purchase order'}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
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
        <Field label="Supplier" required>
          <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">Select</option>
            {suppliers?.map((supplier) => (
              <option key={supplier._id} value={supplier._id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <PurchaseOrderLinePicker lines={lines} onChange={setLines} />

      {lines.length > 0 && (
        <div className="mt-4 flex justify-end">
          <div className="w-56 rounded-md bg-muted/60 px-4 py-2.5 text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold tabular">{formatMoney(totalPaise)}</p>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}
