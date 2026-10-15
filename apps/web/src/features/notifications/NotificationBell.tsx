import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CircleAlert, TriangleAlert, Info } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationSummary,
  type NotificationSeverity,
} from './notificationsApi';

const SEVERITY_ICON = {
  INFO: Info,
  WARNING: TriangleAlert,
  CRITICAL: CircleAlert,
} as const;

const SEVERITY_COLOUR: Record<NotificationSeverity, string> = {
  INFO: 'text-primary',
  WARNING: 'text-warning-foreground',
  CRITICAL: 'text-destructive',
};

/**
 * The bell in the header: how many things need attention, and the newest few.
 *
 * Clicking one marks it read and goes to what it is about, so an overdue invoice is
 * one click from its page. Read state is the signed-in person's own - clearing your
 * alerts does not clear anyone else's.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useNotificationSummary();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unread = data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-input bg-card hover:bg-accent"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close notifications" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-20 w-80 rounded-md border-2 border-primary bg-popover shadow-lg">
            <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-2">
              <span className="font-serif text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => markAll.mutate()}>
                  Mark all read
                </button>
              )}
            </div>

            {!data || data.latest.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing needs your attention.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                {data.latest.map((item) => {
                  const Icon = SEVERITY_ICON[item.severity];
                  return (
                    <li key={item._id}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent"
                        onClick={() => {
                          markRead.mutate(item._id);
                          setOpen(false);
                          if (item.link) navigate(item.link);
                        }}
                      >
                        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', SEVERITY_COLOUR[item.severity])} aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{item.title}</span>
                          {item.body && <span className="block text-xs text-muted-foreground">{item.body}</span>}
                          <span className="block text-[11px] text-muted-foreground">{formatRelative(item.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-border px-3 py-2 text-center text-sm text-primary hover:bg-accent"
            >
              See all notifications
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
