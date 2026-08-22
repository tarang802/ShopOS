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
  defaultPriceListId?: string;
  isActive: boolean;
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
}

export function useCreateCustomer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) => api.post<Customer>('/customers', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['customers'] }),
  });
}
