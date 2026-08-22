import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';

export interface Supplier {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  city?: string;
  isActive: boolean;
}

export function useSuppliers(search?: string) {
  return useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => api.list<Supplier>(`/suppliers${toQuery({ search, limit: 100 })}`),
    select: (result: PaginatedResult<Supplier>) => result.items,
    staleTime: 30_000,
  });
}

export interface SupplierInput {
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  city?: string;
}

export function useCreateSupplier() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierInput) => api.post<Supplier>('/suppliers', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export interface PurchaseOrderItem {
  productId: string;
  productName: string;
  sku: string;
  unitSymbol: string;
  orderedQty: number;
  receivedQty: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface PurchaseOrderSummary {
  _id: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  number: string;
  status: 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  orderDate: string;
  totalPaise: number;
  items: PurchaseOrderItem[];
}

export interface GoodsReceiptRecord {
  _id: string;
  number: string;
  receivedDate: string;
  receivedByName: string;
  items: { productName: string; sku: string; unitSymbol: string; receivedQty: number }[];
}

export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  receipts: GoodsReceiptRecord[];
  createdByName: string;
  notes?: string;
}

export function usePurchaseOrders(params: { branchId?: string | null; status?: string; page?: number }) {
  return useQuery({
    queryKey: ['purchase-orders', params],
    queryFn: () =>
      api.list<PurchaseOrderSummary>(
        `/purchase-orders${toQuery({ branchId: params.branchId, status: params.status, page: params.page ?? 1, limit: 25 })}`,
      ),
    placeholderData: (previous: PaginatedResult<PurchaseOrderSummary> | undefined) => previous,
  });
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['purchase-orders', 'detail', id],
    queryFn: () => api.get<PurchaseOrderDetail>(`/purchase-orders/${id}`),
    enabled: Boolean(id),
  });
}

export interface CreatePurchaseOrderLineInput {
  productId: string;
  orderedQty: number;
  unitPricePaise: number;
}

export interface CreatePurchaseOrderInput {
  branchId: string;
  supplierId: string;
  notes?: string;
  items: CreatePurchaseOrderLineInput[];
}

function invalidatePurchaseOrders(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: ['purchase-orders'] });
  void client.invalidateQueries({ queryKey: ['inventory'] });
  void client.invalidateQueries({ queryKey: ['products'] });
  void client.invalidateQueries({ queryKey: ['dashboard'] });
}

export function useCreatePurchaseOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePurchaseOrderInput) => api.post<PurchaseOrderDetail>('/purchase-orders', input),
    onSuccess: () => invalidatePurchaseOrders(client),
  });
}

export function useSendPurchaseOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<PurchaseOrderDetail>(`/purchase-orders/${id}/send`),
    onSuccess: () => invalidatePurchaseOrders(client),
  });
}

export function useCancelPurchaseOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<PurchaseOrderDetail>(`/purchase-orders/${id}/cancel`),
    onSuccess: () => invalidatePurchaseOrders(client),
  });
}

export interface ReceiveGoodsInput {
  items: { productId: string; receivedQty: number }[];
  notes?: string;
}

export function useReceiveGoods() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReceiveGoodsInput }) =>
      api.post(`/purchase-orders/${id}/receive`, input),
    onSuccess: () => invalidatePurchaseOrders(client),
  });
}
