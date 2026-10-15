import { getAccessToken } from '@/stores/authStore';

/**
 * Save a file the API generates, such as a CSV report.
 *
 * A plain link cannot do this: the API wants the access token in a header, and the
 * token lives in memory rather than a cookie. So the file is fetched with the token,
 * held as a blob, and handed to the browser as a download.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = getAccessToken();
  const response = await fetch(`${BASE_URL}/api/v1${path}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? 'Could not download the file');
  }

  // The server names the file; fall back to a sensible name if the header is absent.
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = named ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
