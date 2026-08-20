import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PriceTier } from '@shopos/shared';
import { api, toQuery, type PaginatedResult } from '@/lib/apiClient';

/**
 * Product queries and mutations in one place.
 *
 * Keeping the query keys here rather than scattered through components means a
 * mutation can invalidate exactly what it changed. When a rate is saved, the
 * product detail refetches and every screen showing that product is correct
 * again without anyone remembering to refresh.
 */

export interface ProductSummary {
  _id: string;
  name: string;
  sku: string;
  brandName?: string;
  categoryName?: string;
  unitSymbol: string;
  unitName: string;
  reorderLevel: number;
  taxRatePercent: number;
  isActive: boolean;
  images: { url: string; publicId: string; isPrimary: boolean }[];
  barcodes: { code: string; type?: string }[];
}

export interface ProductRateCard {
  priceListId: string;
  priceListName: string;
  priceListCode: string;
  isDefault: boolean;
  tiers: PriceTier[];
  updatedAt: string | null;
}

export interface ProductBranchStock {
  branchId: string;
  branchName: string;
  quantity: number;
  lastMovementAt: string | null;
}

export interface ProductDetail {
  product: ProductSummary & {
    description?: string;
    brandId?: string;
    categoryId?: string;
    unitId: string;
    createdAt: string;
    updatedAt: string;
  };
  prices: ProductRateCard[];
  stock: ProductBranchStock[];
  totalStock: number;
}

export interface ProductListParams {
  search?: string;
  page?: number;
  limit?: number;
  categoryId?: string;
  brandId?: string;
  status?: 'active' | 'archived' | 'all';
}

export const productKeys = {
  all: ['products'] as const,
  list: (params: ProductListParams) => ['products', 'list', params] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
};

export function useProducts(params: ProductListParams) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () =>
      api.list<ProductSummary>(
        `/products${toQuery({
          search: params.search,
          page: params.page ?? 1,
          limit: params.limit ?? 25,
          categoryId: params.categoryId,
          brandId: params.brandId,
          status: params.status ?? 'active',
        })}`,
      ),
    // Search results feel broken if the table empties between keystrokes, so the
    // previous page stays on screen until the new one arrives.
    placeholderData: (previous: PaginatedResult<ProductSummary> | undefined) => previous,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(id ?? ''),
    queryFn: () => api.get<ProductDetail>(`/products/${id}`),
    enabled: Boolean(id),
  });
}

export interface ProductInput {
  name: string;
  sku?: string;
  description?: string;
  brandId?: string;
  categoryId?: string;
  unitId: string;
  taxRatePercent?: number;
  reorderLevel?: number;
  barcodes?: { code: string }[];
}

export function useCreateProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) => api.post<ProductSummary>('/products', input),
    onSuccess: () => client.invalidateQueries({ queryKey: productKeys.all }),
  });
}

export function useUpdateProduct(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ProductInput>) =>
      api.patch<ProductSummary>(`/products/${id}`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: productKeys.all });
      void client.invalidateQueries({ queryKey: productKeys.detail(id) });
    },
  });
}

export function useArchiveProduct(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (isActive: boolean) => api.post(`/products/${id}/archive`, { isActive }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: productKeys.all });
      void client.invalidateQueries({ queryKey: productKeys.detail(id) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Supporting lists                                                            */
/* -------------------------------------------------------------------------- */

export interface NamedRecord {
  _id: string;
  name: string;
}

export interface UnitRecord extends NamedRecord {
  symbol: string;
  allowsDecimal: boolean;
}

function useSimpleList<T>(resource: string) {
  return useQuery({
    queryKey: [resource],
    queryFn: () => api.list<T>(`/${resource}${toQuery({ limit: 100 })}`),
    select: (result: PaginatedResult<T>) => result.items,
    staleTime: 5 * 60_000,
  });
}

export const useCategories = () => useSimpleList<NamedRecord>('categories');
export const useBrands = () => useSimpleList<NamedRecord>('brands');
export const useUnits = () => useSimpleList<UnitRecord>('units');

export function useCreateNamedRecord(resource: 'categories' | 'brands') {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<NamedRecord>(`/${resource}`, { name }),
    onSuccess: () => client.invalidateQueries({ queryKey: [resource] }),
  });
}
