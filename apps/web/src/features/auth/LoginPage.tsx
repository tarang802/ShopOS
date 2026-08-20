import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/apiClient';
import { useAuthStore, type Session } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { GoogleSignInButton } from './GoogleSignInButton';

/**
 * Sign in.
 *
 * Deliberately plain: one column, large fields, no marketing. The person opening
 * this is a shop owner or a counter assistant starting their day, often on a
 * modest laptop or a phone in a busy shop, and every extra element is something
 * between them and their work.
 */

interface Capabilities {
  googleLogin: boolean;
  googleClientId?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: capabilities } = useQuery({
    queryKey: ['auth', 'capabilities'],
    queryFn: () => api.get<Capabilities>('/auth/capabilities'),
    staleTime: Infinity,
  });

  const login = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post<Session>('/auth/login', body),
    onSuccess: (session) => {
      setSession(session);
      navigate('/', { replace: true });
    },
    onError: (cause) => {
      setError(
        cause instanceof ApiRequestError ? cause.message : 'Could not sign in. Please try again.',
      );
    },
  });

  const googleLogin = useMutation({
    mutationFn: (credential: string) => api.post<Session>('/auth/google', { credential }),
    onSuccess: (session) => {
      setSession(session);
      navigate('/', { replace: true });
    },
    onError: (cause) => {
      // A Google account with no business attached needs the sign-up flow, so
      // the user is sent there rather than shown a dead end.
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setError('No business is linked to this Google account yet. Create one to continue.');
        return;
      }
      setError(cause instanceof ApiRequestError ? cause.message : 'Google sign-in failed.');
    },
  });

  const busy = login.isPending || googleLogin.isPending;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Store className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">ShopOS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your shop, your rates, always up to date
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-1 text-base font-semibold">Sign in</h2>
          <p className="mb-5 text-sm text-muted-foreground">साइन इन करें</p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              login.mutate({ email, password });
            }}
          >
            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@yourshop.com"
              />
            </Field>

            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
              />
            </Field>

            {error && (
              <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {login.isPending ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          {capabilities?.googleLogin && capabilities.googleClientId && (
            <>
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <GoogleSignInButton
                clientId={capabilities.googleClientId}
                onCredential={(credential) => {
                  setError(null);
                  googleLogin.mutate(credential);
                }}
              />
            </>
          )}
        </div>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          New business?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create your account
          </Link>
        </p>
      </div>
    </div>
  );
}
