import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';

export interface Customer {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  defaultPriceListId?: string;
  creditDays?: number;
  creditLimitPaise?: number;
  isActive: boolean;
  /** Present when the list was asked for balances. */
  outstandingPaise?: number;
}

export function useCustomers(search?: string) {
  return useQuery({
    queryKey: ['customers', search],
    queryFn: () => api.list<Customer>(`/customers${toQuery({ search, limit: 100 })}`),
    select: (result: PaginatedResult<Customer>) => result.items,
    staleTime: 30_000,
  });
}

export interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  defaultPriceListId?: string;
  creditDays?: number;
  creditLimitPaise?: number;
  isActive?: boolean;
}

export function useCreateCustomer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) => api.post<Customer>('/customers', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['customers'] }),
  });
}

export function useUpdateCustomer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CustomerInput> & { id: string }) =>
      api.patch<Customer>(`/customers/${id}`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['customers'] }),
  });
}
