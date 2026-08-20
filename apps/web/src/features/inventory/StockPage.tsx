import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, ClipboardCheck, Search, Warehouse } from 'lucide-react';
import { ADJUSTMENT_REASONS, PERMISSIONS } from '@shopos/shared';
import { useAuthStore, useHasPermission } from '@/stores/authStore';
import { useBranches } from '@/hooks/useBranches';
import { ADJUSTMENT_REASON_LABELS, LABELS } from '@/lib/labels';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ApiRequestError } from '@/lib/apiClient';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useCreateAdjustment, useStock } from './inventoryApi';
import { ProductPicker, type PickedLine } from './ProductPicker';

/**
 * The stock register.
 *
 * Shows what is on hand, branch by branch, with anything at or below its reorder
 * level called out. The reorder level is per product on purpose: a shop keeps
 * two thousand pencils and five ladders, so a single organization-wide threshold
 * would either scream constantly or never fire.
 */

function AdjustStockDialog({
  open,
  onOpenChange,
  defaultBranchId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultBranchId?: string;
}) {
  const { data: branches } = useBranches();
  const adjust = useCreateAdjustment();

  const [branchId, setBranchId] = useState(defaultBranchId ?? '');
  const [reason, setReason] = useState<string>(ADJUSTMENT_REASONS.PHYSICAL_COUNT);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PickedLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBranchId(defaultBranchId ?? branches?.[0]?._id ?? '');
    setReason(ADJUSTMENT_REASONS.PHYSICAL_COUNT);
    setNotes('');
    setLines([]);
    setError(null);
  }, [open, defaultBranchId, branches]);

  const ready = branchId && lines.length > 0 && lines.every((line) => line.quantity !== '');

  function submit() {
    setError(null);
    adjust.mutate(
      {
        branchId,
        reason,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: lines.map((line) => ({
          productId: line.product._id,
          countedQuantity: Number(line.quantity),
        })),
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (cause) =>
          setError(
            cause instanceof ApiRequestError ? cause.message : 'Could not save the adjustment',
          ),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Correct stock"
      description="स्टॉक सुधारें"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={adjust.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || adjust.isPending}>
            {adjust.isPending ? 'Saving...' : 'Save correction'}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Branch" required>
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">Select a branch</option>
            {branches?.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Reason" required hint="Every correction is recorded against your name">
          <Select value={reason} onChange={(event) => setReason(event.target.value)}>
            {Object.entries(ADJUSTMENT_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label.en} / {label.hi}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <ProductPicker
        lines={lines}
        onChange={setLines}
        quantityLabel="Counted quantity"
        quantityHint="Enter what you actually counted, not the difference. ShopOS works out the change."
      />

      <Field label="Notes" className="mt-4">
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What happened, in your own words"
        />
      </Field>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}

export function StockPage() {
  const [searchParams] = useSearchParams();
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const canAdjust = useHasPermission(PERMISSIONS.INVENTORY_ADJUST);
  const canTransfer = useHasPermission(PERMISSIONS.INVENTORY_TRANSFER);

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [lowOnly, setLowOnly] = useState(searchParams.get('low') === '1');
  const [page, setPage] = useState(1);
  const [adjustOpen, setAdjustOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(term);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isPending, isError, error, refetch } = useStock({
    search: debounced,
    branchId: activeBranchId,
    lowStockOnly: lowOnly,
    page,
  });

  const rows = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="mx-auto max-w-6xl">
      <LabelledPageHeader
        label={LABELS.stock}
        description="What is on hand right now, branch by branch"
        actions={
          <>
            {canTransfer && (
              <Link
                to="/transfers"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent"
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden />
                Transfers
              </Link>
            )}
            {canAdjust && (
              <Button onClick={() => setAdjustOpen(true)}>
                <ClipboardCheck className="h-4 w-4" aria-hidden />
                Correct stock
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search product or item code"
            className="pl-9"
            aria-label="Search stock"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(event) => {
              setLowOnly(event.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 rounded border-input"
          />
          Only running low
        </label>
      </div>

      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'Could not load stock'}
          onRetry={() => void refetch()}
        />
      ) : !isPending && rows.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title={lowOnly ? 'Nothing is running low' : 'No stock recorded yet'}
          message={
            lowOnly
              ? 'Every product is above its reorder level.'
              : 'Once you record opening stock or receive goods, quantities appear here.'
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Branch</TH>
                <TH numeric>In stock</TH>
                <TH numeric>Reorder at</TH>
                <TH>Last movement</TH>
              </TR>
            </THead>
            <TBody>
              {isPending ? (
                <TableMessage colSpan={5}>Loading stock...</TableMessage>
              ) : (
                rows.map((row) => (
                  <TR key={row._id}>
                    <TD>
                      <Link
                        to={`/products/${row.productId}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {row.productName}
                      </Link>
                      <span className="block text-xs text-muted-foreground tabular">
                        {row.sku}
                        {row.brandName ? ` - ${row.brandName}` : ''}
                      </span>
                    </TD>
                    <TD>{row.branchName}</TD>
                    <TD numeric>
                      <span className={row.isLow ? 'font-semibold text-destructive' : ''}>
                        {formatNumber(row.quantity)} {row.unitSymbol}
                      </span>
                      {row.isLow && (
                        <Badge variant="warning" className="ml-2">
                          {LABELS.lowStock.en}
                        </Badge>
                      )}
                    </TD>
                    <TD numeric className="text-muted-foreground">
                      {row.reorderLevel > 0 ? formatNumber(row.reorderLevel) : '-'}
                    </TD>
                    <TD className="text-muted-foreground">{formatDateTime(row.lastMovementAt)}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <AdjustStockDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        {...(activeBranchId ? { defaultBranchId: activeBranchId } : {})}
      />
    </div>
  );
}
