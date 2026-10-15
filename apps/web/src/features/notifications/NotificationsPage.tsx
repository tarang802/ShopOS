import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type NotificationSeverity,
} from './notificationsApi';

const ICON = { INFO: Info, WARNING: TriangleAlert, CRITICAL: CircleAlert } as const;
const COLOUR: Record<NotificationSeverity, string> = {
  INFO: 'text-primary',
  WARNING: 'text-warning-foreground',
  CRITICAL: 'text-destructive',
};

/** Everything that has needed attention, newest first, with unread ones picked out. */
export function NotificationsPage() {
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error, refetch } = useNotifications({ unreadOnly, page });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle="सूचनाएं"
        description="Stock running low, money overdue and anything else that needs a look"
        actions={
          <Button variant="outline" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            Mark all read
          </Button>
        }
      />

      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input"
          checked={unreadOnly}
          onChange={(event) => {
            setUnreadOnly(event.target.checked);
            setPage(1);
          }}
        />
        Unread only
      </label>

      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : 'Could not load notifications'} onRetry={() => void refetch()} />
      ) : !isPending && items.length === 0 ? (
        <EmptyState icon={Bell} title="All clear" message={unreadOnly ? 'You have read everything.' : 'Nothing has needed attention yet.'} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {items.map((item) => {
            const Icon = ICON[item.severity];
            return (
              <li key={item._id}>
                <button
                  type="button"
                  className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent', !item.isRead && 'bg-accent/50')}
                  onClick={() => {
                    if (!item.isRead) markRead.mutate(item._id);
                    if (item.link) navigate(item.link);
                  }}
                >
                  <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', COLOUR[item.severity])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', !item.isRead && 'font-semibold')}>{item.title}</span>
                    {item.body && <span className="block text-sm text-muted-foreground">{item.body}</span>}
                    <span className="block text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                  </span>
                  {!item.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-sm bg-brass" aria-label="Unread" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

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
    </div>
  );
}
