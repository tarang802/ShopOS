import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';

export interface InvoiceLine {
  productId: string;
  productName: string;
  sku: string;
  unitSymbol: string;
  quantity: number;
  unitPricePaise: number;
  taxRatePercent: number;
  subtotalPaise: number;
  taxPaise: number;
  lineTotalPaise: number;
}

export interface InvoiceSummary {
  _id: string;
  branchId: string;
  branchName: string;
  customerId?: string;
  customerName: string;
  number: string;
  status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
  invoiceDate: string;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  items: InvoiceLine[];
  outstandingPaise: number;
  notes?: string;
  createdByName: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export function useInvoices(params: { branchId?: string | null; status?: string; page?: number }) {
  return useQuery({
    queryKey: ['invoices', params],
    queryFn: () =>
      api.list<InvoiceSummary>(
        `/invoices${toQuery({ branchId: params.branchId, status: params.status, page: params.page ?? 1, limit: 25 })}`,
      ),
    placeholderData: (previous: PaginatedResult<InvoiceSummary> | undefined) => previous,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ['invoices', 'detail', id],
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`),
    enabled: Boolean(id),
  });
}

export interface CreateInvoiceLineInput {
  productId: string;
  quantity: number;
  priceListId?: string;
}

export interface CreateInvoiceInput {
  branchId: string;
  customerId?: string;
  customerName?: string;
  notes?: string;
  items: CreateInvoiceLineInput[];
}

function invalidateInvoiceQueries(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: ['invoices'] });
  void client.invalidateQueries({ queryKey: ['inventory'] });
  void client.invalidateQueries({ queryKey: ['products'] });
  void client.invalidateQueries({ queryKey: ['dashboard'] });
}

export function useCreateInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) => api.post<InvoiceDetail>('/invoices', input),
    onSuccess: () => invalidateInvoiceQueries(client),
  });
}

export function useCancelInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<InvoiceDetail>(`/invoices/${id}/cancel`, { reason }),
    onSuccess: () => invalidateInvoiceQueries(client),
  });
}
