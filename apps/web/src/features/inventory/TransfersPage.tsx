import { useEffect, useState } from 'react';
import { ArrowLeftRight, Plus, Truck } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { useBranches } from '@/hooks/useBranches';
import { LABELS } from '@/lib/labels';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ApiRequestError } from '@/lib/apiClient';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Select, Textarea } from '@/components/ui/field';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/ui/states';
import {
  useCancelTransfer,
  useCreateTransfer,
  useReceiveTransfer,
  useTransfers,
  type TransferRow,
} from './inventoryApi';
import { ProductPicker, type PickedLine } from './ProductPicker';

/**
 * Moving stock between branches.
 *
 * Deliberately two steps. Stock leaves the source when it is sent and only
 * appears at the destination when someone there confirms it arrived. In between
 * it is IN TRANSIT and belongs to neither - which is the truth, and stops the
 * receiving branch promising goods that are still on a truck.
 */

const STATUS_STYLE: Record<TransferRow['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'outline' }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  IN_TRANSIT: { label: 'On the way', variant: 'warning' },
  RECEIVED: { label: 'Received', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'outline' },
};

function NewTransferDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: branches } = useBranches();
  const createTransfer = useCreateTransfer();

  const [fromBranchId, setFromBranchId] = useState('');
  const [toBranchId, setToBranchId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PickedLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFromBranchId(branches?.[0]?._id ?? '');
    setToBranchId('');
    setNotes('');
    setLines([]);
    setError(null);
  }, [open, branches]);

  const ready =
    fromBranchId &&
    toBranchId &&
    fromBranchId !== toBranchId &&
    lines.length > 0 &&
    lines.every((line) => Number(line.quantity) > 0);

  function submit() {
    setError(null);
    createTransfer.mutate(
      {
        fromBranchId,
        toBranchId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: lines.map((line) => ({
          productId: line.product._id,
          quantity: Number(line.quantity),
        })),
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (cause) =>
          setError(cause instanceof ApiRequestError ? cause.message : 'Could not send the stock'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Send stock to another branch"
      description="स्टॉक भेजें"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createTransfer.isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || createTransfer.isPending}>
            {createTransfer.isPending ? 'Sending...' : 'Send stock'}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="From branch" required>
          <Select value={fromBranchId} onChange={(event) => setFromBranchId(event.target.value)}>
            <option value="">Select</option>
            {branches?.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="To branch"
          required
          {...(fromBranchId && fromBranchId === toBranchId
            ? { error: 'Choose two different branches' }
            : {})}
        >
          <Select value={toBranchId} onChange={(event) => setToBranchId(event.target.value)}>
            <option value="">Select</option>
            {branches
              ?.filter((branch) => branch._id !== fromBranchId)
              .map((branch) => (
                <option key={branch._id} value={branch._id}>
                  {branch.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      <ProductPicker
        lines={lines}
        onChange={setLines}
        quantityLabel="Quantity to send"
        quantityHint="Stock leaves the source branch straight away and shows as on the way until it is received."
      />

      <Field label="Notes" className="mt-4">
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Vehicle number, driver, anything useful"
        />
      </Field>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}

export function TransfersPage() {
  const canTransfer = useHasPermission(PERMISSIONS.INVENTORY_TRANSFER);
  const [status, setStatus] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [receiving, setReceiving] = useState<TransferRow | null>(null);
  const [cancelling, setCancelling] = useState<TransferRow | null>(null);

  const { data, isPending, isError, error, refetch } = useTransfers({
    status: status || undefined,
  });
  const receive = useReceiveTransfer();
  const cancel = useCancelTransfer();

  const transfers = data?.items ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <LabelledPageHeader
        label={LABELS.transfers}
        description="Stock moving between your branches"
        actions={
          canTransfer ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Send stock
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Select
          className="w-48"
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All transfers</option>
          <option value="IN_TRANSIT">On the way</option>
          <option value="RECEIVED">Received</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'Could not load transfers'}
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading transfers...</p>
      ) : transfers.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No transfers yet"
          message="When you move stock from one branch to another, it appears here until the receiving branch confirms it."
          action={
            canTransfer ? (
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Send stock
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {transfers.map((transfer) => {
            const style = STATUS_STYLE[transfer.status];
            const totalSent = transfer.items.reduce((sum, item) => sum + item.quantity, 0);
            const shortfall = transfer.items.reduce(
              (sum, item) => sum + (item.quantity - item.receivedQuantity),
              0,
            );

            return (
              <Card key={transfer._id}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold tabular">{transfer.number}</span>
                        <Badge variant={style.variant}>{style.label}</Badge>
                      </div>
                      <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                        {transfer.fromBranchName}
                        <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
                        {transfer.toBranchName}
                      </p>
                    </div>

                    {transfer.status === 'IN_TRANSIT' && canTransfer && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setCancelling(transfer)}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={() => setReceiving(transfer)}>
                          <Truck className="h-4 w-4" aria-hidden />
                          Mark received
                        </Button>
                      </div>
                    )}
                  </div>

                  <ul className="mt-3 divide-y divide-border border-t border-border">
                    {transfer.items.map((item) => (
                      <li
                        key={item.productId}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{item.productName}</span>
                          <span className="text-xs text-muted-foreground tabular">
                            {item.productSku}
                          </span>
                        </span>
                        <span className="shrink-0 tabular">
                          {formatNumber(item.quantity)} {item.unitSymbol}
                          {transfer.status === 'RECEIVED' &&
                            item.receivedQuantity !== item.quantity && (
                              <span className="ml-2 text-destructive">
                                received {formatNumber(item.receivedQuantity)}
                              </span>
                            )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-3 text-xs text-muted-foreground">
                    {formatNumber(totalSent)} units sent by {transfer.createdByName} on{' '}
                    {formatDateTime(transfer.dispatchedAt ?? transfer.createdAt)}
                    {transfer.status === 'RECEIVED' && transfer.receivedByName && (
                      <>
                        {' '}- received by {transfer.receivedByName} on{' '}
                        {formatDateTime(transfer.receivedAt)}
                        {shortfall > 0 && (
                          <span className="text-destructive">
                            {' '}
                            - {formatNumber(shortfall)} units short
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <NewTransferDialog open={newOpen} onOpenChange={setNewOpen} />

      <ConfirmDialog
        open={Boolean(receiving)}
        onOpenChange={(open) => !open && setReceiving(null)}
        title="Confirm this stock arrived?"
        message={`Everything on ${receiving?.number ?? ''} will be added to ${receiving?.toBranchName ?? 'the destination branch'}.`}
        confirmLabel="Yes, it arrived"
        busy={receive.isPending}
        onConfirm={() => {
          if (!receiving) return;
          receive.mutate(receiving._id, { onSuccess: () => setReceiving(null) });
        }}
      />

      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancel this transfer?"
        message={`The stock on ${cancelling?.number ?? ''} goes back to ${cancelling?.fromBranchName ?? 'the source branch'}. This is recorded in the stock history.`}
        confirmLabel="Cancel transfer"
        destructive
        busy={cancel.isPending}
        onConfirm={() => {
          if (!cancelling) return;
          cancel.mutate(cancelling._id, { onSuccess: () => setCancelling(null) });
        }}
      />
    </div>
  );
}
