import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/apiClient';
import { useAuthStore, type Session } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';

/**
 * Create a business account.
 *
 * One screen, seven fields. Signing up creates the owner, the business, its
 * first branch, the six starting roles, the three rate lists and eleven units of
 * measure - all of it behind this form. The owner lands on a working shop, not
 * on a setup checklist.
 *
 * Business type is asked because it costs one dropdown and tells us how ShopOS
 * is actually being used across trades.
 */

const BUSINESS_TYPES = [
  'Stationery',
  'Hardware',
  'Electrical',
  'Sanitary',
  'Medical / Pharma Distribution',
  'Mobile & Accessories',
  'Grocery / Kirana',
  'Garments',
  'Auto Parts',
  'General Wholesale',
  'Other',
];

export function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    businessName: '',
    businessType: '',
    city: '',
  });

  const update = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const register = useMutation({
    mutationFn: (body: typeof form) => api.post<Session>('/auth/register', body),
    onSuccess: (session) => {
      setSession(session);
      navigate('/', { replace: true });
    },
    onError: (cause) => {
      setError(
        cause instanceof ApiRequestError ? cause.message : 'Could not create the account.',
      );
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-md border-2 border-brass bg-primary text-brass shadow-md">
            <Store className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="font-serif text-3xl font-semibold tracking-wide text-primary">Start with ShopOS</h1>
          <p className="mt-1 text-sm text-muted-foreground">अपना बिज़नेस अकाउंट बनाएं</p>
        </div>

        <form
          className="rounded-md border-2 border-primary bg-card p-6 shadow-[6px_6px_0_0_color-mix(in_oklch,var(--primary)_18%,transparent)]"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            register.mutate(form);
          }}
        >
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your business
          </h2>

          <Field label="Business name" required>
            <Input
              required
              value={form.businessName}
              onChange={(event) => update('businessName')(event.target.value)}
              placeholder="Gupta Traders"
            />
          </Field>

          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Business type">
              <Select
                value={form.businessType}
                onChange={(event) => update('businessType')(event.target.value)}
              >
                <option value="">Select</option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="City">
              <Input
                value={form.city}
                onChange={(event) => update('city')(event.target.value)}
                placeholder="Bhagalpur"
              />
            </Field>
          </div>

          <h2 className="mb-4 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your login
          </h2>

          <Field label="Your name" required>
            <Input
              required
              value={form.name}
              onChange={(event) => update('name')(event.target.value)}
              placeholder="Ramesh Gupta"
            />
          </Field>

          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Email" required>
              <Input
                type="email"
                required
                autoComplete="username"
                value={form.email}
                onChange={(event) => update('email')(event.target.value)}
              />
            </Field>

            <Field label="Mobile number">
              <Input
                value={form.phone}
                onChange={(event) => update('phone')(event.target.value)}
                placeholder="98765 43210"
              />
            </Field>
          </div>

          <Field label="Password" required hint="At least 10 characters">
            <Input
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => update('password')(event.target.value)}
            />
          </Field>

          {error && (
            <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={register.isPending}>
            {register.isPending ? 'Setting up your shop...' : 'Create account'}
          </Button>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Your first branch, staff roles and retail / wholesale / dealer rate lists are set up
            automatically.
          </p>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
