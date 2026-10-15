import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { invalidateSalesQueries } from './invoicesApi';

export interface CreateSalesReturnInput {
  invoiceId: string;
  reason: string;
  notes?: string;
  items: { productId: string; quantity: number; restock?: boolean }[];
  refund?: { method: string; amountPaise: number; reference?: string };
}

export interface SalesReturnRecord {
  _id: string;
  number: string;
  creditPaise: number;
  refundedPaise: number;
}

export function useCreateSalesReturn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSalesReturnInput) => api.post<SalesReturnRecord>('/sales-returns', input),
    onSuccess: () => invalidateSalesQueries(client),
  });
}

export function useRefundSalesReturn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: { id: string; method: string; amountPaise: number; reference?: string }) =>
      api.post<SalesReturnRecord>(`/sales-returns/${id}/refund`, input),
    onSuccess: () => invalidateSalesQueries(client),
  });
}
