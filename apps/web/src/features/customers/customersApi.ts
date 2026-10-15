import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';
import type { Statement } from '../purchasing/purchasingApi';

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

export interface CustomerSummary {
  customer: Customer;
  outstandingPaise: number;
  refundDuePaise: number;
  netBalancePaise: number;
  overduePaise: number;
  openInvoices: number;
  overdueInvoices: number;
  lifetimeSalesPaise: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
  creditLimitPaise: number;
  creditAvailablePaise: number | null;
}

export function useCustomerSummary(id: string | undefined) {
  return useQuery({
    queryKey: ['customers', 'summary', id],
    queryFn: () => api.get<CustomerSummary>(`/customers/${id}/summary`),
    enabled: Boolean(id),
  });
}

export function useCustomerStatement(id: string | undefined, range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['customers', 'statement', id, range],
    queryFn: () =>
      api.get<Statement & { customer: { name: string } }>(`/customers/${id}/statement${toQuery(range)}`),
    enabled: Boolean(id),
  });
}

/** Customers with what each one owes, for the list. */
export function useCustomersWithBalance(search?: string) {
  return useQuery({
    queryKey: ['customers', 'with-balance', search],
    queryFn: () => api.list<Customer>(`/customers${toQuery({ search, limit: 100, withBalance: 'true' })}`),
    select: (result: PaginatedResult<Customer>) => result.items,
  });
}
