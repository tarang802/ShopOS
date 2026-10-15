import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';
import { invalidateSalesQueries, type InvoiceDetail } from './invoicesApi';

/** The line shared by quotations and sales orders: terms frozen when the price was committed. */
export interface DocumentLine {
  productId: string;
  productName: string;
  sku: string;
  unitSymbol: string;
  quantity: number;
  unitPricePaise: number;
  grossPaise: number;
  discountPercent: number;
  discountPaise: number;
  taxRatePercent: number;
  subtotalPaise: number;
  taxPaise: number;
  lineTotalPaise: number;
  /** Sales orders only: how much has been billed so far. */
  invoicedQty?: number;
}

export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

export interface QuotationSummary {
  _id: string;
  number: string;
  status: QuotationStatus;
  customerId?: string;
  customerName: string;
  branchId: string;
  branchName: string;
  quotationDate: string;
  validUntil: string;
  totalPaise: number;
  convertedTo?: { type: 'SALES_ORDER' | 'INVOICE'; id: string; number: string };
}

export interface QuotationDetail extends QuotationSummary {
  items: DocumentLine[];
  discountPaise: number;
  subtotalPaise: number;
  taxPaise: number;
  notes?: string;
  terms?: string;
  createdByName: string;
}

export function useQuotations(params: { status?: string; q?: string; page?: number; branchId?: string | null }) {
  return useQuery({
    queryKey: ['quotations', params],
    queryFn: () =>
      api.list<QuotationSummary>(`/quotations${toQuery({ ...params, page: params.page ?? 1, limit: 25 })}`),
    placeholderData: (previous: PaginatedResult<QuotationSummary> | undefined) => previous,
  });
}

export function useQuotation(id: string | undefined) {
  return useQuery({
    queryKey: ['quotations', 'detail', id],
    queryFn: () => api.get<QuotationDetail>(`/quotations/${id}`),
    enabled: Boolean(id),
  });
}

export interface CreateQuotationInput {
  branchId: string;
  customerId?: string;
  validDays?: number;
  notes?: string;
  terms?: string;
  items: { productId: string; quantity: number; priceListId?: string; discountPercent?: number }[];
}

export function useCreateQuotation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQuotationInput) => api.post<QuotationDetail>('/quotations', input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['quotations'] }),
  });
}

export function useQuotationAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'send' | 'accept' | 'reject' }) =>
      api.post<QuotationDetail>(`/quotations/${id}/${action}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['quotations'] }),
  });
}

export function useExtendQuotation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      api.post<QuotationDetail>(`/quotations/${id}/extend`, { days }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['quotations'] }),
  });
}

export function useConvertQuotationToOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ _id: string }>(`/quotations/${id}/convert-to-order`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['quotations'] });
      void client.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });
}

export function useConvertQuotationToInvoice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, creditDays }: { id: string; creditDays?: number }) =>
      api.post<InvoiceDetail>(`/quotations/${id}/convert-to-invoice`, creditDays === undefined ? {} : { creditDays }),
    onSuccess: () => invalidateSalesQueries(client),
  });
}
