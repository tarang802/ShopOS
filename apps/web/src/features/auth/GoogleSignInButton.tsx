import { useEffect, useRef } from 'react';

/**
 * Google Sign-In, using Google Identity Services.
 *
 * HOW it works: Google renders its own button and, when the user picks an
 * account, hands the page a signed ID token. That token is posted to our API,
 * which verifies the signature against Google's public keys and checks the token
 * was issued for our client id. The browser never sees a secret, and the API
 * never trusts the browser's word about who the user is.
 *
 * The button simply does not render when no client id is configured, so a
 * deployment without Google keys shows a clean password-only login rather than a
 * broken control.
 */

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleAccounts {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
      }) => void;
      renderButton: (
        element: HTMLElement,
        options: { theme: string; size: string; width: number; text: string; shape: string },
      ) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

/** Shared across every mount, so the script is fetched exactly once. */
let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  // The promise is cached rather than the script tag being re-checked.
  //
  // WHY: React StrictMode mounts every component twice in development. The first
  // mount starts the download and is then cleaned up; the second mount finds the
  // <script> tag already in the DOM. Treating "tag exists" as "script has run"
  // resolves instantly while the file is still downloading, so `window.google`
  // is undefined and the button silently never appears. Sharing one promise
  // means the second caller waits for the same load the first one started.
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);

    if (existing) {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load Google Sign-In')));
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Sign-In'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function GoogleSignInButton({
  clientId,
  onCredential,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Held in a ref so re-renders do not re-initialise Google's widget with a
  // stale callback.
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    let cancelled = false;

    void loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        if (!window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => callbackRef.current(response.credential),
        });

        window.google.accounts.id.renderButton(containerRef.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'continue_with',
          shape: 'rectangular',
        });
      })
      .catch(() => {
        // A blocked or failed script is not fatal: password sign-in still works,
        // and an error message here would only confuse the user.
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <div ref={containerRef} className="flex justify-center" />;
}
