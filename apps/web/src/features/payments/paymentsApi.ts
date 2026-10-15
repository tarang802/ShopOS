import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';
import { invalidateSalesQueries } from '../sales/invoicesApi';

export interface PaymentRow {
  _id: string;
  number: string;
  branchId: string;
  customerId?: string;
  customerName: string;
  amountPaise: number;
  method: string;
  reference?: string;
  paymentDate: string;
  status: 'RECORDED' | 'VOIDED';
  voidReason?: string;
  voidedByName?: string;
  createdByName: string;
  allocations: { invoiceId: string; invoiceNumber: string; amountPaise: number }[];
}

export interface PaymentFilters {
  q?: string;
  status?: string;
  method?: string;
  customerId?: string;
  from?: string;
  to?: string;
  page?: number;
}

export function usePayments(filters: PaymentFilters) {
  return useQuery({
    queryKey: ['payments', filters],
    queryFn: () => api.list<PaymentRow>(`/payments${toQuery({ ...filters, page: filters.page ?? 1, limit: 25 })}`),
    placeholderData: (previous: PaginatedResult<PaymentRow> | undefined) => previous,
  });
}

export function useVoidPayment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<PaymentRow>(`/payments/${id}/void`, { reason }),
    onSuccess: () => invalidateSalesQueries(client),
  });
}

export interface OpenInvoice {
  _id: string;
  number: string;
  invoiceDate: string;
  dueDate?: string;
  totalPaise: number;
  outstandingPaise: number;
  overdueDays: number;
  customerId?: string;
  customerName: string;
  branchId: string;
}

/** Invoices a payment can still be applied to, oldest due first. */
export function useOpenInvoices(customerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['payments', 'open-invoices', customerId ?? 'walk-in'],
    queryFn: () =>
      api.get<OpenInvoice[]>(`/payments/outstanding-invoices${toQuery({ customerId })}`),
    enabled,
  });
}
