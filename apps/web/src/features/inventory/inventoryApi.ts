import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';

/** Stock queries and the mutations that move it. */

export interface StockRow {
  _id: string;
  productId: string;
  productName: string;
  sku: string;
  brandName?: string;
  categoryName?: string;
  unitSymbol: string;
  reorderLevel: number;
  branchId: string;
  branchName: string;
  quantity: number;
  lastMovementAt: string | null;
  isLow: boolean;
}

export interface MovementRow {
  _id: string;
  type: string;
  productId: string;
  productName: string;
  productSku: string;
  quantityDelta: number;
  balanceAfter: number;
  branchName: string;
  reason?: string;
  notes?: string;
  referenceNumber?: string;
  performedByName: string;
  occurredAt: string;
}

export interface TransferRow {
  _id: string;
  number: string;
  status: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  fromBranchName: string;
  toBranchName: string;
  fromBranchId: string;
  toBranchId: string;
  items: {
    productId: string;
    productName: string;
    productSku: string;
    unitSymbol: string;
    quantity: number;
    receivedQuantity: number;
  }[];
  notes?: string;
  createdByName: string;
  receivedByName?: string;
  dispatchedAt?: string;
  receivedAt?: string;
  createdAt: string;
}

export const inventoryKeys = {
  all: ['inventory'] as const,
  stock: (params: unknown) => ['inventory', 'stock', params] as const,
  movements: (params: unknown) => ['inventory', 'movements', params] as const,
  transfers: (params: unknown) => ['inventory', 'transfers', params] as const,
};

export function useStock(params: {
  search?: string;
  branchId?: string | null;
  lowStockOnly?: boolean;
  page?: number;
}) {
  return useQuery({
    queryKey: inventoryKeys.stock(params),
    queryFn: () =>
      api.list<StockRow>(
        `/inventory/stock${toQuery({
          search: params.search,
          branchId: params.branchId,
          lowStockOnly: params.lowStockOnly ? 'true' : undefined,
          page: params.page ?? 1,
          limit: 25,
        })}`,
      ),
    placeholderData: (previous: PaginatedResult<StockRow> | undefined) => previous,
  });
}

export function useMovements(params: {
  productId?: string;
  branchId?: string | null;
  type?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: inventoryKeys.movements(params),
    queryFn: () =>
      api.list<MovementRow>(
        `/inventory/movements${toQuery({
          productId: params.productId,
          branchId: params.branchId,
          type: params.type,
          page: params.page ?? 1,
          limit: 25,
        })}`,
      ),
    placeholderData: (previous: PaginatedResult<MovementRow> | undefined) => previous,
  });
}

export function useTransfers(params: { status?: string; branchId?: string | null; page?: number }) {
  return useQuery({
    queryKey: inventoryKeys.transfers(params),
    queryFn: () =>
      api.list<TransferRow>(
        `/inventory/transfers${toQuery({
          status: params.status,
          branchId: params.branchId,
          page: params.page ?? 1,
          limit: 25,
        })}`,
      ),
  });
}

/** Everything that moves stock invalidates the same tree, plus the dashboard. */
function useStockMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: inventoryKeys.all });
      void client.invalidateQueries({ queryKey: ['products'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export interface AdjustmentInput {
  branchId: string;
  reason: string;
  notes?: string;
  items: { productId: string; countedQuantity: number }[];
}

export const useCreateAdjustment = () =>
  useStockMutation((input: AdjustmentInput) => api.post('/inventory/adjustments', input));

export interface TransferInput {
  fromBranchId: string;
  toBranchId: string;
  notes?: string;
  items: { productId: string; quantity: number }[];
}

export const useCreateTransfer = () =>
  useStockMutation((input: TransferInput) => api.post('/inventory/transfers', input));

export const useReceiveTransfer = () =>
  useStockMutation((transferId: string) =>
    api.post(`/inventory/transfers/${transferId}/receive`, {}),
  );

export const useCancelTransfer = () =>
  useStockMutation((transferId: string) =>
    api.post(`/inventory/transfers/${transferId}/cancel`, {}),
  );
