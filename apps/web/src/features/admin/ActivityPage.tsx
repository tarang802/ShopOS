import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api, toQuery } from '@/lib/apiClient';
import { LABELS } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';

/**
 * The activity log.
 *
 * Answers the question an owner actually asks when a rate looks wrong: who
 * changed it, when, and what was it before. The before and after columns hold
 * only the fields that changed, which is what makes the log readable rather than
 * a wall of unchanged values.
 *
 * There is no way to edit or delete anything here, by design.
 */

interface AuditEntry {
  _id: string;
  action: string;
  entityType: string;
  entityLabel?: string;
  userName: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt: string;
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        typeof entry === 'object' && entry !== null
          ? Object.values(entry as Record<string, unknown>).join(' ')
          : String(entry),
      )
      .join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${key}: ${String(nested)}`)
      .join(', ');
  }
  return String(value);
}

function ChangeSummary({ entry }: { entry: AuditEntry }) {
  const keys = [...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])];
  if (keys.length === 0) return <span className="text-muted-foreground">-</span>;

  return (
    <ul className="space-y-0.5">
      {keys.slice(0, 4).map((key) => (
        <li key={key} className="text-xs">
          <span className="text-muted-foreground">{key}: </span>
          {entry.before?.[key] !== undefined && (
            <>
              <span className="text-muted-foreground line-through">
                {describeValue(entry.before[key])}
              </span>
              <span className="text-muted-foreground"> to </span>
            </>
          )}
          <span className="font-medium">{describeValue(entry.after?.[key])}</span>
        </li>
      ))}
      {keys.length > 4 && (
        <li className="text-xs text-muted-foreground">and {keys.length - 4} more</li>
      )}
    </ul>
  );
}

export function ActivityPage() {
  const [page, setPage] = useState(1);

  const { data, isPending } = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => api.list<AuditEntry>(`/audit-logs${toQuery({ page, limit: 25 })}`),
  });

  const entries = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="mx-auto max-w-6xl">
      <LabelledPageHeader
        label={LABELS.auditLog}
        description="Who changed what, and what it was before"
      />

      {!isPending && entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="Nothing recorded yet"
          message="Changes to products, rates, stock and staff appear here as they happen."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Who</TH>
                <TH>What</TH>
                <TH>Changes</TH>
              </TR>
            </THead>
            <TBody>
              {isPending ? (
                <TableMessage colSpan={4}>Loading activity...</TableMessage>
              ) : (
                entries.map((entry) => (
                  <TR key={entry._id}>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </TD>
                    <TD className="font-medium">{entry.userName}</TD>
                    <TD>
                      <Badge variant="outline">
                        {entry.action.toLowerCase().replace(/_/g, ' ')}
                      </Badge>
                      {entry.entityLabel && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {entry.entityLabel}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <ChangeSummary entry={entry} />
                    </TD>
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
    </div>
  );
}
