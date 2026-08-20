import { useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { INVENTORY_TRANSACTION_TYPES } from '@shopos/shared';
import { useAuthStore } from '@/stores/authStore';
import { LABELS, MOVEMENT_LABELS } from '@/lib/labels';
import { formatDateTime, formatNumber } from '@/lib/format';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useMovements } from './inventoryApi';

/**
 * The stock ledger, as staff see it.
 *
 * Every row is an event that actually happened: what moved, by how much, what
 * the balance became, who did it and why. This is what makes a missing forty
 * pieces answerable rather than merely noticeable - and it is append-only, so
 * nothing here can be quietly tidied up afterwards.
 */
export function MovementsPage() {
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error, refetch } = useMovements({
    branchId: activeBranchId,
    type: type || undefined,
    page,
  });

  const rows = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="mx-auto max-w-6xl">
      <LabelledPageHeader
        label={LABELS.movements}
        description="Every stock movement, with who did it and why"
      />

      <div className="mb-4">
        <Select
          className="w-56"
          aria-label="Movement type"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All movements</option>
          {Object.values(INVENTORY_TRANSACTION_TYPES).map((value) => (
            <option key={value} value={value}>
              {MOVEMENT_LABELS[value]?.en ?? value}
            </option>
          ))}
        </Select>
      </div>

      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'Could not load stock history'}
          onRetry={() => void refetch()}
        />
      ) : !isPending && rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="No stock movements yet"
          message="Opening stock, corrections and transfers all appear here as they happen."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Product</TH>
                <TH>Branch</TH>
                <TH>What happened</TH>
                <TH numeric>Change</TH>
                <TH numeric>Balance after</TH>
                <TH>By</TH>
              </TR>
            </THead>
            <TBody>
              {isPending ? (
                <TableMessage colSpan={7}>Loading stock history...</TableMessage>
              ) : (
                rows.map((row) => {
                  const label = MOVEMENT_LABELS[row.type];
                  const inbound = row.quantityDelta > 0;
                  return (
                    <TR key={row._id}>
                      <TD className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(row.occurredAt)}
                      </TD>
                      <TD>
                        <Link
                          to={`/products/${row.productId}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {row.productName}
                        </Link>
                        <span className="block text-xs text-muted-foreground tabular">
                          {row.productSku}
                        </span>
                      </TD>
                      <TD>{row.branchName}</TD>
                      <TD>
                        <span>{label?.en ?? row.type}</span>
                        {row.referenceNumber && (
                          <span className="block text-xs text-muted-foreground tabular">
                            {row.referenceNumber}
                          </span>
                        )}
                        {row.notes && (
                          <span className="block text-xs text-muted-foreground">{row.notes}</span>
                        )}
                      </TD>
                      <TD numeric>
                        <span className={inbound ? 'text-success' : 'text-destructive'}>
                          {inbound ? '+' : ''}
                          {formatNumber(row.quantityDelta)}
                        </span>
                      </TD>
                      <TD numeric>{formatNumber(row.balanceAfter)}</TD>
                      <TD className="text-muted-foreground">{row.performedByName}</TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} -{' '}
                {formatNumber(pagination.total)} movements
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
    </div>
  );
}
