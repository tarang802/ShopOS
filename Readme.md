# ShopOS

Multi-tenant operations platform for Indian wholesale and retail businesses.

ShopOS is internal business software, not a storefront. It exists to answer one
question instantly and correctly, for every member of staff, at every branch:

> **What does this cost right now, and how many do we have?**
> *आज का भाव क्या है, और स्टॉक कितना है?*

A staff member searches **Natraj** and sees the item code, brand, unit, every
rate slab under retail / wholesale / dealer, and the stock at each branch -
without phoning the owner to confirm the rate.

---

## Status: Phases 0 to 8 complete

The catalogue, pricing engine and inventory engine work end to end, with a full
web app on top.

| Phase | Scope | State |
|---|---|---|
| 0 | Requirements and architecture review | Done |
| 1 | Project setup | Done |
| 2 | Database and entity design - 18 models | Done |
| 3 | Authentication, incl. Google Sign-In | Done |
| 4 | Organizations, branches, staff | Done |
| 5 | RBAC with branch scoping | Done |
| 6 | Product catalogue and search | Done |
| 7 | Pricing engine with quantity slabs | Done |
| 8 | Inventory: ledger, corrections, transfers | Done |
| 9-12 | Purchasing, sales, invoices, payments | Next |
| 13-15 | Notifications, dashboard depth, reports | |
| 16-19 | Testing, security review, performance, deployment | |

**36 end-to-end checks pass** - `npm run smoke` - covering the pricing slab
boundaries, stock movement, insufficient-stock refusal, permissions and tenant
isolation.

---

## What works today

**Catalogue** - products with item codes, barcodes, brands, categories and
units. Server-side search that handles exact codes, full phrases and half-typed
words.

**Pricing** - retail, wholesale and dealer rate lists, each with quantity slabs:

```
1 - 9      Rs 5.00
10 - 49    Rs 4.80
50 - 99    Rs 4.50
100+       Rs 4.20
```

Overlapping slabs, gaps and cards that do not start at 1 are refused. A rate
calculator on every product answers "how much for 150?" directly.

**Inventory** - branch-wise stock on an append-only ledger. Corrections carry a
reason and a name. Transfers are two-step, so goods in transit belong to neither
branch. Selling more than you have is refused, unless the owner turns that off
deliberately.

**Staff and access** - six starting roles, editable per business. Permission-
based throughout; a Patna manager cannot see Ranchi's stock.

**Activity log** - who changed what, when, and what it was before.

---

## Getting started

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

Set `MONGODB_URI` in `apps/api/.env` - that is the only required value. See
[docs/keys-and-secrets.md](docs/keys-and-secrets.md) for every key, where to get
it, and what happens without it.

```bash
npm run seed
```

```bash
npm run dev
```

API on <http://localhost:4000/api/v1>, web on <http://localhost:5173>.

## Stack

**Frontend** React 19, TypeScript, Vite, Tailwind v4, React Router, TanStack
Query, Zustand, Radix

**Backend** Node.js, Express 5, TypeScript, Mongoose 9, MongoDB, Zod, Helmet,
Pino, bcrypt, JWT

**Images** Cloudinary, signed browser-direct upload. Binaries never touch
MongoDB.

## Layout

```
apps/api        Express REST API - 18 models, 12 modules
apps/web        React dashboard
packages/shared Types, constants, and the pricing rules used by both sides
docs            Architecture, database, API, business rules, security, keys, deployment
scripts         End-to-end smoke test
```

## Scripts

|---|---|
| `npm run dev` | API and web together 

