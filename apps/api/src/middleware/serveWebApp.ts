import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Serve the built web app from the API process.
 *
 * One process, one address: the browser then talks to the same origin for pages and
 * for /api, so the refresh cookie stays first-party, there is no CORS to configure,
 * and a deployment is a single service rather than two that must agree.
 *
 * Mounted after the API routes, so /api/... is never shadowed:
 *   - files that exist (the Vite build) are served as they are, fingerprinted assets
 *     cached for a year and everything else revalidated;
 *   - any other GET for a page (/sales, /customers/123 ...) gets index.html, because
 *     the browser, not the server, routes those;
 *   - a missing file (/assets/gone.js) or any /api path falls through to the normal
 *     JSON 404 instead of being answered with a page.
 */
export function serveWebApp(app: Express, directory: string): void {
  const root = path.resolve(directory);
  const indexFile = path.join(root, 'index.html');

  if (!existsSync(indexFile)) {
    throw new Error(
      `WEB_DIST_DIR is set to ${root}, which has no index.html. Build the web app first (npm run build).`,
    );
  }

  const assetsDir = `${path.sep}assets${path.sep}`;
  app.use(
    express.static(root, {
      index: false,
      setHeaders(res, filePath) {
        res.setHeader(
          'Cache-Control',
          filePath.includes(assetsDir) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );

  app.use((req, res, next) => {
    const isPageRequest =
      (req.method === 'GET' || req.method === 'HEAD') &&
      !req.path.startsWith('/api') &&
      path.extname(req.path) === '';

    if (!isPageRequest) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
}
