import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'RETURNED' | 'CANCELLED';

export interface InvoiceLine {
  productId: string;
  productName: string;
  sku: string;
  unitSymbol: string;
  quantity: number;
  unitPricePaise: number;
  grossPaise?: number;
  discountPercent?: number;
  discountPaise?: number;
  taxRatePercent: number;
  subtotalPaise: number;
  taxPaise: number;
  lineTotalPaise: number;
  returnedQty?: number;
  /** Present only for people who hold costs:view. */
  unitCostPaise?: number;
}

export interface InvoiceSummary {
  _id: string;
  branchId: string;
  branchName: string;
  customerId?: string;
  customerName: string;
  number: string;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate?: string;
  subtotalPaise: number;
  discountPaise?: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  returnedPaise?: number;
  refundedPaise?: number;
  outstandingPaise: number;
  refundDuePaise: number;
  overdueDays: number;
}

export interface InvoicePaymentRow {
  _id: string;
  number: string;
  paymentDate: string;
  method: string;
  reference?: string;
  status: 'RECORDED' | 'VOIDED';
  voidReason?: string;
  amountPaise: number;
}

export interface InvoiceReturnRow {
  _id: string;
  number: string;
  returnDate: string;
  reason: string;
  creditPaise: number;
  refundedPaise: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  items: InvoiceLine[];
  notes?: string;
  creditDays?: number;
  salesOrderId?: string;
  salesOrderNumber?: string;
  createdByName: string;
  cancelledAt?: string;
  cancelReason?: string;
  payments: InvoicePaymentRow[];
  returns: InvoiceReturnRow[];
}

export interface InvoiceFilters {
  branchId?: string | null;
  status?: string;
  q?: string;
  customerId?: string;
  overdue?: boolean;
  outstandingOnly?: boolean;
  from?: string;
  to?: string;
  page?: number;
}

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn: () =>
      api.list<InvoiceSummary>(
        `/invoices${toQuery({
          branchId: filters.branchId,
          status: filters.status,
          q: filters.q,
          customerId: filters.customerId,
          overdue: filters.overdue ? 'true' : undefined,
          outstandingOnly: filters.outstandingOnly ? 'true' : undefined,
          from: filters.from,
          to: filters.to,
          page: filters.page ?? 1,
          limit: 25,
        })}`,
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
  discountPercent?: number;
}

export interface CreateInvoiceInput {
  branchId: string;
  customerId?: string;
  customerName?: string;
  creditDays?: number;
  notes?: string;
  items: CreateInvoiceLineInput[];
  payment?: { method: string; amountPaise: number; reference?: string };
}

/** Everything a sale touches, so the screens that show any of it refresh together. */
export function invalidateSalesQueries(client: ReturnType<typeof useQueryClient>) {
  for (const key of [
    'invoices',
    'payments',
    'inventory',
    'products',
    'dashboard',
    'customers',
    'sales-returns',
    'sales-orders',
    'quotations',
    'notifications',
    'reports',
  ]) {
    void client.invalidateQueries({ queryKey: [key] });
  }
}

export function useCreateInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) => api.post<InvoiceDetail>('/invoices', input),
    onSuccess: () => invalidateSalesQueries(client),
  });
}

export function useCancelInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<InvoiceDetail>(`/invoices/${id}/cancel`, { reason }),
    onSuccess: () => invalidateSalesQueries(client),
  });
}
