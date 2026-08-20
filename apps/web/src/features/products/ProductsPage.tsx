import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Package, Plus, Search } from 'lucide-react';
import { PERMISSIONS } from '@shopos/shared';
import { useHasPermission } from '@/stores/authStore';
import { LABELS } from '@/lib/labels';
import { formatNumber } from '@/lib/format';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useBrands, useCategories, useProducts } from './productsApi';
import { ProductFormDialog } from './ProductFormDialog';

/**
 * The catalogue.
 *
 * Search runs on the server on every keystroke, debounced. The alternative -
 * loading every product into the browser and filtering there - works fine on a
 * demo of eight items and falls over on a real shop with twelve thousand.
 */
export function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const canCreate = useHasPermission(PERMISSIONS.PRODUCTS_CREATE);

  const [term, setTerm] = useState(searchParams.get('search') ?? '');
  const [debounced, setDebounced] = useState(term);
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [addOpen, setAddOpen] = useState(false);

  // 300ms is long enough to skip the intermediate letters of a word and short
  // enough that the list feels like it is keeping up.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(term);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  // Keep the URL in step, so a search can be bookmarked or sent to a colleague.
  useEffect(() => {
    setSearchParams(debounced ? { search: debounced } : {}, { replace: true });
  }, [debounced, setSearchParams]);

  const { data: categories } = useCategories();
  const { data: brands } = useBrands();

  const { data, isPending, isError, error, refetch, isFetching } = useProducts({
    search: debounced,
    page,
    categoryId: categoryId || undefined,
    brandId: brandId || undefined,
    status,
  });

  const products = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="mx-auto max-w-6xl">
      <LabelledPageHeader
        label={LABELS.products}
        description="Everything you sell, with its item code, brand and unit"
        actions={
          canCreate ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add product
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Name, item code or barcode"
            className="pl-9"
            aria-label="Search products"
          />
        </div>

        <Select
          className="w-40"
          aria-label="Category"
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          {categories?.map((category) => (
            <option key={category._id} value={category._id}>
              {category.name}
            </option>
          ))}
        </Select>

        <Select
          className="w-40"
          aria-label="Brand"
          value={brandId}
          onChange={(event) => {
            setBrandId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All brands</option>
          {brands?.map((brand) => (
            <option key={brand._id} value={brand._id}>
              {brand.name}
            </option>
          ))}
        </Select>

        <Select
          className="w-36"
          aria-label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </Select>
      </div>

      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : 'Could not load products'}
          onRetry={() => void refetch()}
        />
      ) : !isPending && products.length === 0 ? (
        <EmptyState
          icon={Package}
          title={debounced ? 'Nothing matched that search' : 'No products yet'}
          message={
            debounced
              ? `Nothing found for "${debounced}". Try a shorter word, or the item code.`
              : 'Add your first product and then set its retail and wholesale rates.'
          }
          action={
            canCreate && !debounced ? (
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add product
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Item code</TH>
                <TH>Brand</TH>
                <TH>Category</TH>
                <TH>Unit</TH>
                <TH numeric>Reorder at</TH>
              </TR>
            </THead>
            <TBody>
              {isPending ? (
                <TableMessage colSpan={6}>Loading products...</TableMessage>
              ) : (
                products.map((product) => (
                  <TR key={product._id}>
                    <TD>
                      <Link
                        to={`/products/${product._id}`}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {product.name}
                      </Link>
                      {!product.isActive && (
                        <Badge variant="outline" className="ml-2">
                          Archived
                        </Badge>
                      )}
                    </TD>
                    <TD className="tabular text-muted-foreground">{product.sku}</TD>
                    <TD>{product.brandName ?? '-'}</TD>
                    <TD>{product.categoryName ?? '-'}</TD>
                    <TD>{product.unitSymbol}</TD>
                    <TD numeric>
                      {product.reorderLevel > 0 ? formatNumber(product.reorderLevel) : '-'}
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} - {formatNumber(pagination.total)}{' '}
                products
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isFetching}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages || isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ProductFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
