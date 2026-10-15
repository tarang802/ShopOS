import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';
import { invalidateSalesQueries, type InvoiceDetail } from './invoicesApi';
import type { DocumentLine } from './quotationsApi';

export type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_INVOICED' | 'INVOICED' | 'CANCELLED';

export interface SalesOrderSummary {
  _id: string;
  number: string;
  status: SalesOrderStatus;
  customerId?: string;
  customerName: string;
  branchId: string;
  branchName: string;
  orderDate: string;
  expectedDate?: string;
  totalPaise: number;
  quotationNumber?: string;
}

export interface SalesOrderDetail extends SalesOrderSummary {
  items: DocumentLine[];
  discountPaise: number;
  subtotalPaise: number;
  taxPaise: number;
  notes?: string;
  createdByName: string;
  cancelReason?: string;
  invoices: { _id: string; number: string; status: string; invoiceDate: string; totalPaise: number; paidPaise: number }[];
}

export function useSalesOrders(params: { status?: string; q?: string; page?: number; branchId?: string | null }) {
  return useQuery({
    queryKey: ['sales-orders', params],
    queryFn: () =>
      api.list<SalesOrderSummary>(`/sales-orders${toQuery({ ...params, page: params.page ?? 1, limit: 25 })}`),
    placeholderData: (previous: PaginatedResult<SalesOrderSummary> | undefined) => previous,
  });
}

export function useSalesOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['sales-orders', 'detail', id],
    queryFn: () => api.get<SalesOrderDetail>(`/sales-orders/${id}`),
    enabled: Boolean(id),
  });
}

export interface CreateSalesOrderInput {
  branchId: string;
  customerId?: string;
  expectedDate?: string;
  notes?: string;
  items: { productId: string; quantity: number; priceListId?: string; discountPercent?: number }[];
}

export function useCreateSalesOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSalesOrderInput) => api.post<SalesOrderDetail>('/sales-orders', input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['sales-orders'] }),
  });
}

export function useConfirmSalesOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<SalesOrderDetail>(`/sales-orders/${id}/confirm`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['sales-orders'] }),
  });
}

export function useCancelSalesOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<SalesOrderDetail>(`/sales-orders/${id}/cancel`, { reason }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['sales-orders'] }),
  });
}

export function useInvoiceSalesOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items?: { productId: string; quantity: number }[] }) =>
      api.post<{ invoice: InvoiceDetail; order: SalesOrderDetail }>(
        `/sales-orders/${id}/invoice`,
        items ? { items } : {},
      ),
    onSuccess: () => invalidateSalesQueries(client),
  });
}
