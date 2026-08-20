import { useEffect, useState } from 'react';
import { PERMISSIONS } from '@shopos/shared';
import { ApiRequestError } from '@/lib/apiClient';
import { useHasPermission } from '@/stores/authStore';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useBrands,
  useCategories,
  useCreateNamedRecord,
  useCreateProduct,
  useUnits,
  useUpdateProduct,
  type ProductDetail,
  type ProductInput,
} from './productsApi';

/**
 * Add or edit a product.
 *
 * Only the name and the unit are required. An owner adding fifty items on a
 * Sunday evening should be able to type a name, pick "Piece" and move on - the
 * item code generates itself, and brand, category and barcode can be filled in
 * later when someone has time.
 *
 * Brands and categories can be created inline, because being sent to another
 * screen to add "Natraj" before you can save a pencil is exactly the kind of
 * friction that makes people abandon the software.
 */

export function ProductFormDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: ProductDetail['product'];
}) {
  const canCreate = useHasPermission(PERMISSIONS.PRODUCTS_CREATE);

  const { data: categories } = useCategories();
  const { data: brands } = useBrands();
  const { data: units } = useUnits();

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct(existing?._id ?? '');
  const createBrand = useCreateNamedRecord('brands');
  const createCategory = useCreateNamedRecord('categories');

  const [error, setError] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const [form, setForm] = useState<ProductInput & { barcode: string }>({
    name: '',
    sku: '',
    description: '',
    brandId: '',
    categoryId: '',
    unitId: '',
    taxRatePercent: 0,
    reorderLevel: 0,
    barcode: '',
  });

  // Reset whenever the dialog opens, so an edit never shows the previous
  // product's values for a moment.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      name: existing?.name ?? '',
      sku: existing?.sku ?? '',
      description: existing?.description ?? '',
      brandId: existing?.brandId ?? '',
      categoryId: existing?.categoryId ?? '',
      unitId: existing?.unitId ?? units?.[0]?._id ?? '',
      taxRatePercent: existing?.taxRatePercent ?? 0,
      reorderLevel: existing?.reorderLevel ?? 0,
      barcode: existing?.barcodes?.[0]?.code ?? '',
    });
  }, [open, existing, units]);

  const busy = createProduct.isPending || updateProduct.isPending;

  async function submit() {
    setError(null);

    const { barcode, ...rest } = form;
    const payload: ProductInput = {
      ...rest,
      name: rest.name.trim(),
      ...(rest.sku?.trim() ? { sku: rest.sku.trim() } : { sku: undefined }),
      ...(rest.brandId ? {} : { brandId: undefined }),
      ...(rest.categoryId ? {} : { categoryId: undefined }),
      ...(rest.description?.trim() ? {} : { description: undefined }),
      ...(barcode.trim() ? { barcodes: [{ code: barcode.trim() }] } : {}),
    };

    // Blank optional fields are dropped rather than sent as empty strings, which
    // the API would reject as invalid ids.
    for (const key of ['sku', 'brandId', 'categoryId', 'description'] as const) {
      if (!payload[key]) delete payload[key];
    }

    try {
      if (existing) await updateProduct.mutateAsync(payload);
      else await createProduct.mutateAsync(payload);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not save the product');
    }
  }

  async function addBrand() {
    const name = newBrand.trim();
    if (!name) return;
    try {
      const brand = await createBrand.mutateAsync(name);
      setForm((current) => ({ ...current, brandId: brand._id }));
      setNewBrand('');
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not add the brand');
    }
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    try {
      const category = await createCategory.mutateAsync(name);
      setForm((current) => ({ ...current, categoryId: category._id }));
      setNewCategory('');
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not add the category');
    }
  }

  if (!canCreate) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={existing ? 'Edit product' : 'Add product'}
      description={existing ? undefined : 'सामान जोड़ें'}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !form.name || !form.unitId}>
            {busy ? 'Saving...' : 'Save product'}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Product name" required className="sm:col-span-2">
          <Input
            value={form.name}
            onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            placeholder="Natraj 621 Pencil"
            autoFocus
          />
        </Field>

        <Field label="Item code" hint="Left blank, ShopOS generates one">
          <Input
            value={form.sku ?? ''}
            onChange={(event) => setForm((c) => ({ ...c, sku: event.target.value }))}
            placeholder="Auto"
          />
        </Field>

        <Field label="Unit" required>
          <Select
            value={form.unitId}
            onChange={(event) => setForm((c) => ({ ...c, unitId: event.target.value }))}
          >
            <option value="">Select a unit</option>
            {units?.map((unit) => (
              <option key={unit._id} value={unit._id}>
                {unit.name} ({unit.symbol})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Brand">
          <Select
            value={form.brandId ?? ''}
            onChange={(event) => setForm((c) => ({ ...c, brandId: event.target.value }))}
          >
            <option value="">No brand</option>
            {brands?.map((brand) => (
              <option key={brand._id} value={brand._id}>
                {brand.name}
              </option>
            ))}
          </Select>
          <div className="mt-2 flex gap-2">
            <Input
              className="h-9"
              value={newBrand}
              onChange={(event) => setNewBrand(event.target.value)}
              placeholder="Add a new brand"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void addBrand()}
              disabled={!newBrand.trim() || createBrand.isPending}
            >
              Add
            </Button>
          </div>
        </Field>

        <Field label="Category">
          <Select
            value={form.categoryId ?? ''}
            onChange={(event) => setForm((c) => ({ ...c, categoryId: event.target.value }))}
          >
            <option value="">No category</option>
            {categories?.map((category) => (
              <option key={category._id} value={category._id}>
                {category.name}
              </option>
            ))}
          </Select>
          <div className="mt-2 flex gap-2">
            <Input
              className="h-9"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              placeholder="Add a new category"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void addCategory()}
              disabled={!newCategory.trim() || createCategory.isPending}
            >
              Add
            </Button>
          </div>
        </Field>

        <Field label="Barcode" hint="Scan or type">
          <Input
            value={form.barcode}
            onChange={(event) => setForm((c) => ({ ...c, barcode: event.target.value }))}
            placeholder="8901234567890"
          />
        </Field>

        <Field label="Reorder level" hint="Warn when stock falls to this">
          <Input
            type="number"
            min={0}
            value={form.reorderLevel ?? 0}
            onChange={(event) =>
              setForm((c) => ({ ...c, reorderLevel: Number(event.target.value) || 0 }))
            }
          />
        </Field>

        <Field label="GST rate (%)" hint="Recorded for reference only">
          <Input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={form.taxRatePercent ?? 0}
            onChange={(event) =>
              setForm((c) => ({ ...c, taxRatePercent: Number(event.target.value) || 0 }))
            }
          />
        </Field>

        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            value={form.description ?? ''}
            onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
            placeholder="Anything staff should know about this item"
          />
        </Field>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
    </Dialog>
  );
}
