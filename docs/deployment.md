# ShopOS Deployment and Local Setup

## Requirements

- Node.js 20 or newer (developed on 24)
- npm 10 or newer (workspaces)
- MongoDB 6 or newer

## Local setup

```bash
npm install
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` and set `MONGODB_URI` - the only required value. Every other
key is optional and documented in [keys-and-secrets.md](keys-and-secrets.md).

Load the demo business (safe to re-run at any time):

```bash
npm run seed
```

Then start both sides:

```bash
npm run dev
```

- API: http://localhost:4000/api/v1
- Web: http://localhost:5173

The Vite dev server proxies `/api` to the API, so the browser only ever talks to
one origin and CORS never gets in the way during development.

Verify the whole stack from **Administration -> System Status** in the web app,
or directly:

```bash
curl http://localhost:4000/api/v1/health
```

## MongoDB must be a replica set

Multi-document transactions require a replica set or a sharded cluster. A
standalone `mongod` cannot run them, and ShopOS needs them from Phase 8 for stock
transfers and goods receipts.

The API detects this at startup. Standalone logs a warning, and System Status
shows **Multi-document transactions: Unavailable**.

### Option A - MongoDB Atlas

Any Atlas cluster, including the free tier, is already a replica set. Use its
connection string as `MONGODB_URI`.

### Option B - local single-node replica set

A single node is still a replica set, so this is enough for development.

Add to your `mongod.cfg` (Windows: `C:\Program Files\MongoDB\Server\<v>\bin\mongod.cfg`):

```yaml
replication:
  replSetName: rs0
```

Restart the MongoDB service, then initialise it once:

```bash
mongosh --eval "rs.initiate()"
```

Point the API at it:

```
MONGODB_URI=mongodb://127.0.0.1:27017/shopos?replicaSet=rs0
```

System Status should then read **Topology: replicaSet**, **transactions:
Supported**.

## Scripts

| Command | Effect |
|---|---|
| `npm run dev` | API and web together |
| `npm run seed` | Rebuild the demo business |
| `npm run smoke` | 36 end-to-end API checks against a running server |
| `npm run dev:api` | API only, with watch reload |
| `npm run dev:web` | Web only |
| `npm run build` | Build both for production |
| `npm run typecheck` | Type-check every workspace |
| `npm test` | Run tests in every workspace |
| `npm run format` | Prettier across the repo |

## Environment variables

Documented in `apps/api/.env.example`. Never commit `.env`.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `development`, `test` or `production` |
| `PORT` | no | Default 4000 |
| `CORS_ORIGINS` | yes in production | Comma-separated allow-list |
| `MONGODB_URI` | yes | Replica set required from Phase 8 |
| `JWT_ACCESS_SECRET` | yes in production | 32+ random characters. `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | yes in production | Must differ from the access secret |
| `ACCESS_TOKEN_TTL` | no | Default `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | no | Default 30 |
| `GOOGLE_CLIENT_ID` | no | Google Sign-In. Hidden when absent |
| `GOOGLE_CLIENT_SECRET` | no | Reserved for future OAuth flows |
| `CLOUDINARY_*` | no | Product images. Upload disabled when absent |
| `LOG_LEVEL` | no | Default `debug` |

Production boot fails if a JWT secret is still a placeholder or shorter than 32
characters. That is deliberate.

## Production build

```bash
npm run build
node apps/api/dist/server.js
```

The API bundles to `apps/api/dist/server.js` (tsup). The web app builds static
assets to `apps/web/dist`, served by any static host or CDN.

Set `VITE_API_BASE_URL` at web build time when the API is on a different origin
than the site, and add that site origin to `CORS_ORIGINS` on the API.

## Health checks

| Endpoint | Use |
|---|---|
| `/api/v1/health/live` | Liveness. Restart the container when this fails |
| `/api/v1/health/ready` | Readiness. 503 while the database is unreachable, so traffic is withheld |
| `/api/v1/health` | Full status, for humans |

## Verifying a deployment

With the API running:

```bash
npm run smoke
```

It signs in, searches the catalogue, checks every pricing slab boundary, refuses
invalid rate cards, corrects stock, transfers between branches, refuses an
oversized transfer, and confirms that branch-scoped staff cannot reach another
branch. All 36 checks must pass.

## Still to do before production

- CI pipeline: typecheck, tests, build
- Shared-store rate limiting (multi-instance correctness)
- Log shipping and error alerting
- Backup and restore procedure, tested by actually restoring
- Secret management and a rotation procedure
