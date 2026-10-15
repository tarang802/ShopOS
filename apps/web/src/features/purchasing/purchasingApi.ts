import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';

export interface Supplier {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  city?: string;
  creditDays?: number;
  isActive: boolean;
  /** Present when the list was asked for balances. */
  owedPaise?: number;
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
  creditDays?: number;
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
  returnedQty?: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export type PayableStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

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
  receivedValuePaise?: number;
  returnedPaise?: number;
  paidPaise?: number;
  dueDate?: string;
  owedPaise: number;
  payableCapPaise: number;
  creditDuePaise: number;
  payableStatus: PayableStatus;
  overdueDays: number;
}

export interface GoodsReceiptRecord {
  _id: string;
  number: string;
  receivedDate: string;
  receivedByName: string;
  items: { productName: string; sku: string; unitSymbol: string; receivedQty: number }[];
}

export interface PurchaseOrderPaymentRow {
  _id: string;
  number: string;
  paymentDate: string;
  method: string;
  reference?: string;
  status: 'RECORDED' | 'VOIDED';
  voidReason?: string;
  amountPaise: number;
}

export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  receipts: GoodsReceiptRecord[];
  payments: PurchaseOrderPaymentRow[];
  returns: { _id: string; number: string; returnDate: string; reason: string; totalPaise: number }[];
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

export function invalidatePurchaseOrders(client: ReturnType<typeof useQueryClient>) {
  for (const key of [
    'purchase-orders',
    'inventory',
    'products',
    'dashboard',
    'suppliers',
    'supplier-payments',
    'notifications',
    'reports',
  ]) {
    void client.invalidateQueries({ queryKey: [key] });
  }
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

export interface SupplierPaymentInput {
  branchId: string;
  supplierId: string;
  amountPaise: number;
  method: string;
  reference?: string;
  allocations: { purchaseOrderId: string; amountPaise: number }[];
}

export function useRecordSupplierPayment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierPaymentInput) => api.post('/supplier-payments', input),
    onSuccess: () => invalidatePurchaseOrders(client),
  });
}

export function useVoidSupplierPayment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/supplier-payments/${id}/void`, { reason }),
    onSuccess: () => invalidatePurchaseOrders(client),
  });
}

/** Orders a supplier payment can still be applied to, oldest due first. */
export function usePayableOrders(supplierId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['supplier-payments', 'payable-orders', supplierId],
    queryFn: () => api.get<PurchaseOrderSummary[]>(`/supplier-payments/payable-orders${toQuery({ supplierId })}`),
    enabled: enabled && Boolean(supplierId),
  });
}

export interface CreatePurchaseReturnInput {
  purchaseOrderId: string;
  reason: string;
  notes?: string;
  items: { productId: string; quantity: number }[];
}

export function useCreatePurchaseReturn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePurchaseReturnInput) => api.post('/purchase-returns', input),
    onSuccess: () => invalidatePurchaseOrders(client),
  });
}

export interface StatementEntry {
  date: string;
  type: string;
  reference: string;
  description: string;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
  link?: { type: string; id: string };
}

export interface Statement {
  openingBalancePaise: number;
  closingBalancePaise: number;
  totalDebitPaise: number;
  totalCreditPaise: number;
  entries: StatementEntry[];
}

export interface SupplierSummary {
  supplier: Supplier;
  owedPaise: number;
  overduePaise: number;
  openOrders: number;
  overdueOrders: number;
  lifetimePurchasesPaise: number;
  orderCount: number;
  lastOrderDate: string | null;
}

export function useSupplierSummary(id: string | undefined) {
  return useQuery({
    queryKey: ['suppliers', 'summary', id],
    queryFn: () => api.get<SupplierSummary>(`/suppliers/${id}/summary`),
    enabled: Boolean(id),
  });
}

export function useSupplierStatement(id: string | undefined, range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['suppliers', 'statement', id, range],
    queryFn: () => api.get<Statement & { supplier: { name: string } }>(`/suppliers/${id}/statement${toQuery(range)}`),
    enabled: Boolean(id),
  });
}

export function useUpdateSupplier() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<SupplierInput> & { id: string }) =>
      api.patch<Supplier>(`/suppliers/${id}`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

/** Suppliers with what is owed to each, for the list. */
export function useSuppliersWithBalance(search?: string) {
  return useQuery({
    queryKey: ['suppliers', 'with-balance', search],
    queryFn: () => api.list<Supplier>(`/suppliers${toQuery({ search, limit: 100, withBalance: 'true' })}`),
    select: (result: PaginatedResult<Supplier>) => result.items,
  });
}
