import { useQuery } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';

export interface Branch {
  _id: string;
  name: string;
  code: string;
  city?: string;
  phone?: string;
  addressLine?: string;
  state?: string;
  pincode?: string;
  isMain: boolean;
  isActive: boolean;
}

/**
 * The branches this user may act in.
 *
 * The server already filters the list by the caller's membership, so a branch
 * manager receives only their own branches. The client never has to work out
 * what to hide - it renders what it is given.
 */
export function useBranches(enabled = true) {
  return useQuery({
    queryKey: ['branches'],
    queryFn: () => api.list<Branch>(`/branches${toQuery({ limit: 100 })}`),
    select: (result: PaginatedResult<Branch>) => result.items,
    staleTime: 5 * 60_000,
    enabled,
  });
}
