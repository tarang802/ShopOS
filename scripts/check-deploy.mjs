#!/usr/bin/env node
/**
 * Check a deployed ShopOS from the outside, the way a browser and an attacker see it.
 *
 *   npm run check:deploy -- https://your-shopos.example.com
 *
 * Read-only: it signs nobody up and changes nothing. Each check prints PASS, WARN or
 * FAIL with a reason, and the exit code is non-zero if anything FAILs, so it can run
 * after every deploy.
 */

const target = process.argv[2];
if (!target) {
  console.error('Usage: npm run check:deploy -- https://your-shopos.example.com');
  process.exit(2);
}
const base = target.replace(/\/+$/, '');
const api = `${base}/api/v1`;
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);

const results = [];
const record = (level, name, detail = '') => {
  results.push(level);
  console.log(`  ${level.padEnd(4)}  ${name}${detail ? ` - ${detail}` : ''}`);
};

async function get(url, init = {}) {
  try {
    return await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(90_000), ...init });
  } catch (error) {
    return { ok: false, status: 0, headers: new Headers(), error, text: async () => '', json: async () => ({}) };
  }
}

console.log(`\nChecking ${base}\n`);
if (!isLocal && !base.startsWith('https://')) record('FAIL', 'Address uses HTTPS', 'production must be served over https://');

// 1. Is it up, and is the database usable for transactions?
const ready = await get(`${api}/health/ready`);
if (ready.status === 0) {
  record('FAIL', 'Reachable', `${ready.error?.cause?.code ?? ready.error?.message ?? 'no response'} (a sleeping free-tier service can take a minute to wake)`);
  process.exit(1);
}
record(ready.status === 200 ? 'PASS' : 'FAIL', 'Ready (database connected)', `HTTP ${ready.status}`);

const status = await (await get(`${api}/health`)).json().catch(() => ({}));
const db = status?.data?.database ?? {};
record(db.supportsTransactions ? 'PASS' : 'FAIL', 'Database supports transactions', `${db.topology ?? 'unknown'}${db.supportsTransactions ? '' : ' - use a replica set such as MongoDB Atlas'}`);
record(status?.data?.environment === 'production' ? 'PASS' : 'FAIL', 'Running in production mode', `NODE_ENV=${status?.data?.environment ?? '?'}`);

// 2. Does it serve the app, including a link opened directly?
const home = await get(`${base}/`);
const homeHtml = await home.text();
record(home.status === 200 && homeHtml.includes('id="root"') ? 'PASS' : 'FAIL', 'Serves the web app', `HTTP ${home.status}`);
const deep = await get(`${base}/customers`);
record(deep.status === 200 && (await deep.text()).includes('id="root"') ? 'PASS' : 'FAIL', 'Opens a page linked directly (/customers)', `HTTP ${deep.status}`);
const unknownApi = await get(`${api}/definitely-not-a-route`);
record(unknownApi.status === 404 && (unknownApi.headers.get('content-type') ?? '').includes('json') ? 'PASS' : 'FAIL', 'Unknown API paths are JSON 404s, not pages');

// 3. The doors that must be shut.
const anonymous = await get(`${api}/products`);
record(anonymous.status === 401 ? 'PASS' : 'FAIL', 'Data needs a sign-in', `GET /products without a token -> HTTP ${anonymous.status}`);
const foreign = await get(`${api}/health`, { headers: { Origin: 'https://evil.example' } });
record(foreign.status === 403 ? 'PASS' : 'FAIL', 'Other websites are refused (CORS)', `HTTP ${foreign.status}`);
const injected = await get(`${api}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ email: { $gt: '' }, password: 'x' }),
});
record(injected.status === 400 ? 'PASS' : 'FAIL', 'Query-operator injection is rejected', `HTTP ${injected.status}`);

// 4. Headers.
const headers = ready.headers;
const hsts = headers.get('strict-transport-security');
record(hsts ? 'PASS' : isLocal ? 'WARN' : 'FAIL', 'HSTS header', hsts ?? 'missing');
const csp = home.headers.get('content-security-policy') ?? '';
record(csp.includes("object-src 'none'") && csp.includes("default-src 'self'") ? 'PASS' : 'FAIL', 'Content-Security-Policy on pages');
record(headers.get('x-powered-by') ? 'FAIL' : 'PASS', 'Framework not advertised (no X-Powered-By)');
record(headers.get('x-content-type-options') === 'nosniff' ? 'PASS' : 'FAIL', 'X-Content-Type-Options: nosniff');

// 5. HTTP should not be left open.
if (!isLocal && base.startsWith('https://')) {
  const plain = await get(base.replace(/^https:/, 'http:') + '/');
  const location = plain.headers.get('location') ?? '';
  record(
    plain.status >= 300 && plain.status < 400 && location.startsWith('https://') ? 'PASS' : 'WARN',
    'Plain HTTP redirects to HTTPS',
    plain.status ? `HTTP ${plain.status}${location ? ` -> ${location}` : ''}` : 'no answer on http (fine if the host only listens on https)',
  );
}

// 6. Assets are cached; the page is not.
const asset = homeHtml.match(/\/assets\/[^"']+\.js/)?.[0];
if (asset) {
  const assetResponse = await get(`${base}${asset}`);
  record((assetResponse.headers.get('cache-control') ?? '').includes('immutable') ? 'PASS' : 'WARN', 'Fingerprinted assets are cached long-term');
}
record((home.headers.get('cache-control') ?? '').includes('no-cache') ? 'PASS' : 'WARN', 'The page itself is revalidated, so deploys show up at once');

const failed = results.filter((level) => level === 'FAIL').length;
const warned = results.filter((level) => level === 'WARN').length;
console.log(`\n  ${results.length - failed - warned} passed, ${warned} warnings, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
