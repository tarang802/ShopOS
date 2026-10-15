import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '@/lib/apiClient';
import { LABELS } from '@/lib/labels';
import { LabelledPageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';

/**
 * Business profile and stock policy.
 *
 * The setting that matters is `allowNegativeStock`. It stays off by default,
 * because stock that quietly goes negative hides a counting problem. But plenty
 * of shops genuinely do sell goods that are physically on the shelf and not yet
 * entered, and refusing that sale is worse for them than a temporarily negative
 * figure - so the switch exists, with its consequence spelled out rather than
 * buried.
 */

interface Organization {
  _id: string;
  name: string;
  businessType?: string;
  gstin?: string;
  phone?: string;
  email?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
  currency: string;
  settings: {
    allowNegativeStock: boolean;
    lowStockThreshold: number;
    maxDiscountPercent?: number;
    enforceCreditLimit?: boolean;
    invoiceFooter?: string;
    paymentInstructions?: string;
  };
}

export function SettingsPage() {
  const client = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ['organization'],
    queryFn: () => api.get<Organization>('/organizations/current'),
  });

  const [form, setForm] = useState({
    name: '',
    businessType: '',
    gstin: '',
    phone: '',
    email: '',
    addressLine: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [maxDiscount, setMaxDiscount] = useState('10');
  const [enforceCreditLimit, setEnforceCreditLimit] = useState(false);
  const [invoiceFooter, setInvoiceFooter] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setForm({
      name: data.name,
      businessType: data.businessType ?? '',
      gstin: data.gstin ?? '',
      phone: data.phone ?? '',
      email: data.email ?? '',
      addressLine: data.addressLine ?? '',
      city: data.city ?? '',
      state: data.state ?? '',
      pincode: data.pincode ?? '',
    });
    setAllowNegativeStock(data.settings.allowNegativeStock);
    setMaxDiscount(String(data.settings.maxDiscountPercent ?? 10));
    setEnforceCreditLimit(data.settings.enforceCreditLimit ?? false);
    setInvoiceFooter(data.settings.invoiceFooter ?? '');
    setPaymentInstructions(data.settings.paymentInstructions ?? '');
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch('/organizations/current', body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['organization'] });
      setMessage('Saved');
      setError(null);
      setTimeout(() => setMessage(null), 2500);
    },
    onError: (cause) => {
      setMessage(null);
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not save');
    },
  });

  if (isPending) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading settings...</p>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <LabelledPageHeader label={LABELS.settings} description="Your business details and stock rules" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Business details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Business name" required className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
              />
            </Field>
            <Field label="Business type">
              <Input
                value={form.businessType}
                onChange={(event) => setForm((c) => ({ ...c, businessType: event.target.value }))}
              />
            </Field>
            <Field label="GSTIN" hint="Recorded for your reference only">
              <Input
                value={form.gstin}
                onChange={(event) =>
                  setForm((c) => ({ ...c, gstin: event.target.value.toUpperCase() }))
                }
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(event) => setForm((c) => ({ ...c, phone: event.target.value }))}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
              />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input
                value={form.addressLine}
                onChange={(event) => setForm((c) => ({ ...c, addressLine: event.target.value }))}
              />
            </Field>
            <Field label="City">
              <Input
                value={form.city}
                onChange={(event) => setForm((c) => ({ ...c, city: event.target.value }))}
              />
            </Field>
            <Field label="State">
              <Input
                value={form.state}
                onChange={(event) => setForm((c) => ({ ...c, state: event.target.value }))}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Stock rules</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={allowNegativeStock}
              onChange={(event) => setAllowNegativeStock(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">Allow stock to go negative</span>
              <span className="block text-sm text-muted-foreground">
                Off by default. With it off, a sale or transfer is refused when there is not enough
                stock. Turn it on only if you regularly sell goods before they are entered - the
                figures will then show negative until you correct them.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Selling rules</CardTitle>
        </CardHeader>
        <CardContent>
          <Field
            label="Discount staff can give on their own (%)"
            hint="Anything above this needs the discount override permission - the place retail fraud actually happens"
            className="max-w-sm"
          >
            <Input type="number" min={0} max={100} value={maxDiscount} onChange={(event) => setMaxDiscount(event.target.value)} />
          </Field>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={enforceCreditLimit}
              onChange={(event) => setEnforceCreditLimit(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">Refuse sales that would take a customer past their credit limit</span>
              <span className="block text-sm text-muted-foreground">
                Off by default, so the limit on a customer is a reference. Turn it on to have invoices refused once a customer with a
                limit would owe more than it.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>On printed invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="How to pay" hint="UPI id or bank account, printed above the footer">
            <Input value={paymentInstructions} maxLength={300} onChange={(event) => setPaymentInstructions(event.target.value)} />
          </Field>
          <Field label="Footer" hint="Terms, returns policy or a thank-you">
            <Textarea value={invoiceFooter} maxLength={500} onChange={(event) => setInvoiceFooter(event.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            save.mutate({
              ...form,
              settings: {
                allowNegativeStock,
                maxDiscountPercent: Math.min(100, Math.max(0, Number(maxDiscount) || 0)),
                enforceCreditLimit,
                invoiceFooter,
                paymentInstructions,
              },
            })
          }
          disabled={save.isPending}
        >
          {save.isPending ? 'Saving...' : 'Save changes'}
        </Button>
        {message && <span className="text-sm text-success">{message}</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}
