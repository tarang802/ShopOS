# ShopOS

Multi-tenant operations platform for Indian wholesale and retail businesses.

ShopOS is internal business software, not a storefront. It exists to answer one
question instantly and correctly, for every member of staff, at every branch:

> **What does this cost right now, and how many do we have?**
> *आज का भाव क्या है, और स्टॉक कितना है?*

A staff member searches **Natraj** and sees the item code, brand, unit, every
rate slab under retail / wholesale / dealer, and the stock at each branch -
without phoning the owner to confirm the rate. From there the same system sells
it, bills it, collects the money, takes goods back, reorders from the supplier and
tells the owner who owes what.

---

## Status: feature complete

| Area | What is built |
|---|---|
| Access | Sign-up, password and Google sign-in, rotating refresh tokens, roles and permissions, branch scoping, activity log |
| Catalogue | Products, item codes, barcodes, brands, categories, units, images, fast search |
| Pricing | Retail / wholesale / dealer lists with quantity slabs, a rate calculator, validation of overlaps and gaps |
| Inventory | Append-only ledger, corrections with reasons, two-step branch transfers, low and out-of-stock alerts |
| Purchasing | Suppliers with credit terms, purchase orders, partial goods receipts, moving-average cost, purchase returns, supplier payments, payables ageing, supplier statements |
| Sales | Customers with credit limits, quotations (expiry, extend, convert), sales orders (partial invoicing), invoices with discounts and credit days, pay at the till, printable documents |
| Returns | Goods returns with proportional credit, refunds bounded by what was paid |
| Payments | Allocated across invoices, voidable with a reason, safe against two people paying at once |
| Receivables | Customer statements, overdue and ageing, refund due |
| Insight | Dashboard with trends and what needs attention, eight reports with CSV export, notification bell with an hourly overdue sweep |
| Quality | 186 automated tests, a 56-check smoke test, security review, CI, Docker |

Money is stored as whole paise throughout, every document freezes the rate, tax
and cost it was written with, and the rules live on the server - the browser only
shows what the server allows.

Business rules are written down in [docs/business-rules.md](docs/business-rules.md).

**Not in scope for v1:** GST-compliant invoice format and returns filing, batch and
expiry tracking, serial numbers, unit conversion, e-mail delivery (invitations and
password reset). See [docs/architecture.md](docs/architecture.md).

---

## Getting started

You need Node.js 20+ and a MongoDB **replica set** (transactions require one).
The easiest way is the bundled script, which starts a private single-node replica
set on port 27018 without touching any MongoDB you already have:

```bash
npm install
```

```bash
npm run db:local
```

Leave that running. In another terminal:

```bash
cp apps/api/.env.example apps/api/.env
```

Set `MONGODB_URI=mongodb://127.0.0.1:27018/shopos?replicaSet=rs0` in
`apps/api/.env` - that is the only required value. (MongoDB Atlas works too; see
[docs/keys-and-secrets.md](docs/keys-and-secrets.md) for every key.) Then:

```bash
npm run seed
```

```bash
npm run dev
```

API on <http://localhost:4000/api/v1>, web on <http://localhost:5173>. The seed
prints the demo business's sign-in details when it finishes.

### With Docker

```bash
cp deploy/.env.example .env     # fill in the two JWT secrets
docker compose up -d --build
```

Then open <http://localhost:8080>. See [docs/deployment.md](docs/deployment.md).

### Running the tests

```bash
npm run db:local      # if it is not already running
npm test              # 186 tests: shared arithmetic, API integration, web helpers
npm run smoke         # 56 end-to-end checks against a running API (reseeds first)
```

The API tests use a throwaway `shopos_test` database that is dropped at the start
of each run; the harness will not touch a database whose name lacks `test`.

---

## Stack

**Frontend** React 19, TypeScript, Vite, Tailwind v4, React Router, TanStack
Query, Zustand, Radix. Screens are code-split per route and print cleanly.

**Backend** Node.js, Express 5, TypeScript, Mongoose 9, MongoDB 6+, Zod, Helmet,
Pino, bcrypt, JWT.

**Images** Cloudinary, signed browser-direct upload. Binaries never touch MongoDB.

## Layout

```
apps/api        Express REST API - 32 models, 18 modules, background jobs
apps/web        React app
packages/shared Types, constants and the pure money, pricing and ageing rules
                used by both sides
deploy          Dockerfiles and nginx config
docs            Architecture, database, API, business rules, security, keys, deployment
scripts         Smoke test and the local replica-set launcher
.github         CI
```

## Scripts

| Command | Effect |
|---|---|
| `npm run dev` | API and web together |
| `npm run db:local` | Private MongoDB replica set on port 27018 |
| `npm run seed` | Rebuild the demo business |
| `npm test` | All tests |
| `npm run smoke` | End-to-end checks against a running API |
| `npm run typecheck` | Type-check every workspace |
| `npm run build` | Production build of both apps |

## Documentation

| | |
|---|---|
| [architecture.md](docs/architecture.md) | Layers, engines, repository layout, testing |
| [business-rules.md](docs/business-rules.md) | What the system enforces, and why |
| [api.md](docs/api.md) | Every endpoint, permission and response shape |
| [database.md](docs/database.md) | Collections, indexing, concurrency, deletion policy |
| [security.md](docs/security.md) | Controls, how they are tested, known gaps |
| [keys-and-secrets.md](docs/keys-and-secrets.md) | Each key, where to get it, what breaks without it |
| [deployment.md](docs/deployment.md) | Local setup, Docker, CI, health checks |
