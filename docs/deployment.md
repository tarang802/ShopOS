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
standalone `mongod` cannot run them, and ShopOS needs them for stock transfers,
goods receipts, invoices, returns and payments.

The API detects this at startup. Standalone logs a warning, and System Status
shows **Multi-document transactions: Unavailable**.

### Option A - MongoDB Atlas

Any Atlas cluster, including the free tier, is already a replica set. Use its
connection string as `MONGODB_URI`.

### Option B - one command (recommended for development)

```bash
npm run db:local
```

starts a private single-node replica set on port 27018 with its own data
directory, leaving any system MongoDB untouched. Then use:

```
MONGODB_URI=mongodb://127.0.0.1:27018/shopos?replicaSet=rs0
```

### Option C - edit your own mongod

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
| `npm run smoke` | 56 end-to-end API checks against a running server (reseeds first) |
| `npm run db:local` | Private single-node MongoDB replica set on port 27018 |
| `npm run dev:api` | API only, with watch reload |
| `npm run dev:web` | Web only |
| `npm run build` | Build both for production |
| `npm run typecheck` | Type-check every workspace |
| `npm test` | Run tests in every workspace (needs a replica set; see below) |
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
| `JOBS_ENABLED` | no | Default true. Hourly overdue sweep; false on all but one instance |
| `TEST_MONGODB_URI` | tests only | Its name must contain `test`. Default `mongodb://127.0.0.1:27018/shopos_test?replicaSet=rs0` |
| `GENERAL_RATE_LIMIT`, `AUTH_RATE_LIMIT` | no | Override the per-IP limits |

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

## Docker

```bash
cp deploy/.env.example .env      # set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET
docker compose up -d --build
docker compose --profile tools run --rm seed     # optional: the demo business
```

The web app is on <http://localhost:8080> (change with `WEB_PORT`). The stack is:

| Service | Image | Notes |
|---|---|---|
| `mongo` | `mongo:7` | Started as a one-node replica set; a healthcheck initiates it on first run. Data in the `mongo-data` volume |
| `api` | `deploy/api.Dockerfile` | Production dependencies and the tsup bundle only, non-root, healthcheck on `/health/ready` |
| `web` | `deploy/web.Dockerfile` | The Vite build behind nginx, which forwards `/api` to the API and falls back to `index.html` for client routes |
| `seed` | api image, `tools` target | One-off demo data; only with `--profile tools` |

Notes:

- The refresh cookie is `Secure` in production. Browsers accept that on
  `http://localhost`, but anywhere else put TLS in front of the `web` service.
- Compose refuses to start without both JWT secrets, and the API refuses to boot in
  production with placeholders.
- To run more than one API container, move rate limiting to a shared store and set
  `JOBS_ENABLED=false` on all but one (see [security.md](security.md)).
- The images are built in CI on every push. The compose files were written without
  Docker available on the author's machine, so treat the first `docker compose up`
  as the real test and report anything that needs adjusting.

## Tests and CI

```bash
npm run db:local        # once, in its own terminal
npm test
```

The API specs need a replica set because the code under test uses transactions.
They connect to `TEST_MONGODB_URI` and **drop that database** at the start of a run;
the harness refuses to touch a database whose name does not contain `test`.

`.github/workflows/ci.yml` runs on every push and pull request: install, typecheck,
`npm test` against a MongoDB 7 replica-set service container, build, `npm audit` on
production dependencies (fails on high severity), then builds both Docker images.

## Verifying a deployment

With the API running:

```bash
npm run smoke
```

It reseeds the demo business, then signs in, searches the catalogue, checks every
pricing slab boundary, refuses invalid rate cards, moves stock, buys on a purchase
order with partial receipts, invoices, cancels, takes and refuses payments, and
confirms that branch-scoped staff cannot reach another branch. All 56 checks must
pass. **Do not run it against production data**: it rewrites the demo business.

## Still to do before production

- Shared-store rate limiting, if running more than one API instance
- Log shipping and error alerting
- Backup and restore procedure, tested by actually restoring (`mongodump` of the
  `mongo-data` volume, or Atlas backups)
- TLS termination and a secret-management and rotation procedure
- Email delivery for invitations and password reset (no mail transport is configured)
