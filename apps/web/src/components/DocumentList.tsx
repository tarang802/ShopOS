import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, type LucideIcon } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Label } from '@/lib/labels';
import { useAuthStore } from '@/stores/authStore';
import type { PaginatedResult } from '@/lib/apiClient';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';

/**
 * A searchable, filterable, paged list of one kind of document.
 *
 * Quotations, sales orders and anything like them are the same screen with
 * different columns, so the screen is written once and each list supplies only its
 * rows' shape. The hook it is given is called on every render, never conditionally.
 */

export interface DocumentColumn<T> {
  header: string;
  numeric?: boolean;
  cell: (row: T) => ReactNode;
}

export function DocumentList<T extends { _id: string }>({
  label,
  description,
  newLabel,
  canCreate,
  onNew,
  statusOptions,
  searchPlaceholder,
  useRows,
  columns,
  rowLink,
  icon,
  emptyMessage,
  dialog,
}: {
  label: Label;
  description: string;
  newLabel: string;
  canCreate: boolean;
  onNew: () => void;
  statusOptions: { value: string; label: string }[];
  searchPlaceholder: string;
  useRows: (params: {
    status?: string;
    q?: string;
    page: number;
    branchId: string | null;
  }) => UseQueryResult<PaginatedResult<T>>;
  columns: DocumentColumn<T>[];
  rowLink: (row: T) => string;
  icon: LucideIcon;
  emptyMessage: string;
  dialog: ReactNode;
}) {
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(term.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isPending, isError, error, refetch } = useRows({
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
    page,
    branchId: activeBranchId,
  });

  const rows = data?.items ?? [];
  const pagination = data?.pagination;
  const filtered = Boolean(q || status);

  const newButton = (
    <Button onClick={onNew}>
      <Plus className="h-4 w-4" aria-hidden />
      {newLabel}
    </Button>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <LabelledPageHeader label={label} description={description} actions={canCreate ? newButton : undefined} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            className="pl-9"
            placeholder={searchPlaceholder}
            aria-label="Search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <Select
          className="w-48"
          aria-label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Every status</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : 'Could not load the list'} onRetry={() => void refetch()} />
      ) : !isPending && rows.length === 0 ? (
        <EmptyState
          icon={icon}
          title={filtered ? 'Nothing matches' : `No ${label.en.toLowerCase()} yet`}
          message={filtered ? 'Try a different search or clear the filter.' : emptyMessage}
          action={canCreate && !filtered ? newButton : undefined}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                {columns.map((column) => (
                  <TH key={column.header} numeric={column.numeric}>
                    {column.header}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {isPending ? (
                <TableMessage colSpan={columns.length}>Loading...</TableMessage>
              ) : (
                rows.map((row) => (
                  <TR key={row._id}>
                    {columns.map((column, index) => (
                      <TD key={column.header} numeric={column.numeric}>
                        {index === 0 ? (
                          <Link to={rowLink(row)} className="font-medium tabular hover:text-primary hover:underline">
                            {column.cell(row)}
                          </Link>
                        ) : (
                          column.cell(row)
                        )}
                      </TD>
                    ))}
                  </TR>
                ))
              )}
            </TBody>
          </Table>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {dialog}
    </div>
  );
}
