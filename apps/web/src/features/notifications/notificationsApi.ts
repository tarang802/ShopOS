import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';

export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface NotificationRow {
  _id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationSummary {
  unreadCount: number;
  latest: NotificationRow[];
}

/** The bell polls once a minute: a shop does not need an alert the same second, and a socket per tab is not worth it. */
export function useNotificationSummary() {
  return useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: () => api.get<NotificationSummary>('/notifications/summary'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotifications(params: { unreadOnly?: boolean; page?: number }) {
  return useQuery({
    queryKey: ['notifications', 'list', params],
    queryFn: () =>
      api.list<NotificationRow>(
        `/notifications${toQuery({ unreadOnly: params.unreadOnly ? 'true' : undefined, page: params.page ?? 1, limit: 25 })}`,
      ),
    placeholderData: (previous: PaginatedResult<NotificationRow> | undefined) => previous,
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
