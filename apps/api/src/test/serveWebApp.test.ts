import express from 'express';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveWebApp } from '../middleware/serveWebApp';

/**
 * One address for pages and API. The things worth pinning down: a page URL typed
 * straight into the browser still opens the app, /api is never answered with a page,
 * and a missing asset is a 404 rather than a confusing 200 full of HTML.
 */

let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'shopos-web-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ShopOS</title><div id="root"></div>');
  writeFileSync(path.join(dir, 'assets', 'app-3f9a1c.js'), 'console.log("app")');
  writeFileSync(path.join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  const app = express();
  app.get('/api/v1/ping', (_req, res) => {
    res.json({ success: true });
  });
  serveWebApp(app, dir);
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  });

  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe('serving the web app from the API', () => {
  it('opens the app at the root and at any page URL typed straight into the browser', async () => {
    for (const route of ['/', '/sales', '/customers/6adb0e37849afdb1c58aec90', '/admin/roles']) {
      const response = await fetch(`${base}${route}`);
      expect(response.status, route).toBe(200);
      expect(await response.text()).toContain('<div id="root">');
      expect(response.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('caches fingerprinted assets for a year and revalidates everything else', async () => {
    const asset = await fetch(`${base}/assets/app-3f9a1c.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const icon = await fetch(`${base}/favicon.svg`);
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('never answers an API call, or an unknown API path, with a page', async () => {
    const real = await fetch(`${base}/api/v1/ping`);
    expect(await real.json()).toEqual({ success: true });

    const unknown = await fetch(`${base}/api/v1/does-not-exist`);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('returns a 404 for a missing file instead of the app', async () => {
    const response = await fetch(`${base}/assets/gone.js`);
    expect(response.status).toBe(404);
  });

  it('does not let a POST fall through to the app', async () => {
    const response = await fetch(`${base}/sales`, { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('refuses to start pointed at a folder that holds no build', () => {
    expect(() => serveWebApp(express(), path.join(dir, 'assets'))).toThrow(/index\.html/);
  });
});
