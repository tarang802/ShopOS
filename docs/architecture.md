# ShopOS Architecture

Status: **Phases 0 to 8 complete.** Catalogue, pricing and inventory work end to
end. Purchasing, sales and finance are phases 9 to 12.

## What ShopOS is

A multi-tenant SaaS platform for physical wholesale and retail businesses. It is
internal operations software, not a storefront. Its central job is to make one
answer always available and always current: *what does this product cost, and how
many do we have, at which branch?*

Everything else exists to keep that answer true and traceable.

## Layering

```
React (browser)
      |  HTTPS, JSON
Express REST API          <- routing, validation, authentication
      |
Service layer             <- all business rules live here
      |
Models + tenant guard     <- tenant scoping enforced here
      |
Mongoose
      |
MongoDB
```

- The browser never talks to MongoDB and never holds database credentials.
- Controllers stay thin: validate, call a service, send a response.
- Business rules live in services, so the same rule serves the web app today and
  a mobile app later without being rewritten.
- Frontend validation is for a pleasant form. Backend validation is the one that
  protects data.

## Repository layout

```
apps/api/src/
  config/       env, database, cloudinary
  core/         AppError, http helpers, logger, tenant context, list queries
  db/
    models/     32 Mongoose models
    migrations.ts  one-off data migrations, run at boot
    plugins/    tenantGuard
    transaction.ts
  middleware/   authenticate, requirePermission, validate, errorHandler, rateLimiter
  modules/      auth, organizations, branches, users, roles, catalog, products,
                pricing, inventory, customers, sales (quotations, orders, invoices,
                returns), payments, purchasing (orders, returns, supplier payments),
                reports, notifications, dashboard, audit, health
  services/     tokenService, inventoryService, costingService, receivablesService,
                payablesService, statementService, notificationService,
                auditService, counterService, organizationBootstrap
  jobs/         hourly overdue sweep (JOBS_ENABLED)
  test/         integration specs against a real replica-set database
  seed/         demo data

apps/web/src/
  components/   ui primitives, PageHeader, DocumentList, StatementTable, charts
  features/     auth, dashboard, products, pricing, inventory, customers, sales,
                purchasing, payments, notifications, reports, admin
  hooks/        useBranches
  layouts/      AppShell
  lib/          apiClient, format, labels, queryClient, utils
  stores/       authStore

packages/shared/src/
  api, enums, money, pagination, permissions, pricing, sales, purchasing,
  validation, __tests__
```

`packages/shared` is consumed as TypeScript source, not as a built package. The
API bundles it with tsup; the web app aliases it in Vite. A shared permission,
enum or pricing rule therefore cannot drift between the two halves.

## Multi-tenancy

One organization is one business. An organization has branches; users belong to
an organization through a **membership**, which also names the branches they may
act in.

```
Organization -> Branch -> (stock, documents)
Organization -> Membership -> User
Membership   -> Role -> Permissions
```

Isolation is enforced three ways, deepest first:

1. A Mongoose plugin throws on any query against an organization-owned
   collection that lacks an `organizationId` filter.
2. Services build every filter from the session's tenant context, never from the
   request body.
3. Every client-supplied reference is re-validated as belonging to the caller's
   business before use.

## The engines

### Pricing

There is no `product.price`. A product is priced through a **price list**, and
under each list it has a **rate card** of quantity slabs. The rules that decide
whether a card is valid, and which slab applies to a quantity, are pure functions
in `packages/shared/src/pricing.ts` - the same code the browser uses to preview a
card as the owner types it and the server uses to accept or reject it.

The card is stored embedded in one document and replaced in one atomic write,
which is what makes "no overlapping slabs" a database guarantee rather than an
application hope.

### Inventory

Stock is an **append-only ledger** plus a cached balance per product per branch.
Every movement writes one ledger row; the balance is the running total and must
always be reproducible from the ledger.

All of it goes through `applyMovement`, the only function in the system that
writes to `inventory_balances`. Decrements use a single conditional atomic update
so two simultaneous sales of the last unit cannot both succeed.

### Money

Amounts are integer paise. The arithmetic that must agree on both sides - a line's
discount and tax, proportional credit for a partial return, what a customer or
supplier still owes, invoice status, days late, ageing buckets, calendar ranges in
the shop's timezone - lives in `packages/shared/src/{money,sales,purchasing}.ts`
as pure functions with their own tests.

Balances (`paidPaise`, `returnedPaise`, `refundedPaise`) are changed only with a
**compare-and-swap**: a conditional `updateOne` that names the figure that was
read. If somebody else changed it first the update matches nothing and the caller
retries or is told, so two cashiers cannot both settle the same bill. Multi-document
changes run in a transaction (`db/transaction.ts`).

### Documents

Quotation, sales order, invoice, return and payment share line and total helpers
(`documentLines`, `documentTotals`). Every line stores what was true when it was
written, so a document never changes when a product or price does. Conversions
(quotation to order or invoice, order to invoice) are *claimed* with a conditional
update first, then performed, so a double click cannot make two.

### Statements and reports

Statements are built from the documents themselves (`buildStatement`), and the
summary figures come from the same queries, so the two cannot disagree. Reports are
aggregations that begin with `$match` on the organization and branch scope - the
same rule the tenant guard enforces for ordinary queries - and return typed columns
so one renderer serves the screen, print and CSV.

### Notifications

`notificationService` raises alerts from the places that cause them (stock changes,
the hourly sweep). A unique `dedupeKey` makes raising idempotent, and read state is
a per-user set on the notification.

### Authorization

Roles are editable documents holding permission strings. No code branches on a
role name. Permissions are resolved from the database per request so a demotion
takes effect immediately.

## Request lifecycle

```
helmet -> cors -> compression -> cookies -> body parse (1mb) -> request logger
  -> rate limit -> route -> authenticate -> requirePermission -> validate
  -> controller -> service -> models -> response envelope
                                    \-> AppError -> errorHandler -> error envelope
```

Middleware order is a security control. Security headers apply before anything
can respond; foreign origins are rejected before work is done; oversized bodies
are refused before parsing; throttling happens before the database is touched.

## Design for Indian shops

Choices made specifically for the people who use this:

- **Money in paise, displayed with Indian grouping.** 1,20,000 not 120,000.
- **Bilingual labels.** English first, the familiar trade word underneath.
  Rates, not prices. Slabs, not tiers. Godown alongside branch.
- **Search in the shell, not on a page.** Looking up a rate is the most frequent
  action; it should never be one click away.
- **A rate calculator on every product.** "How much for 150?" answered directly.
- **Adjustments require a reason.** Without a legitimate way to correct a count,
  staff invent illegitimate ones.
- **Negative stock is a setting, not a rule.** Many shops genuinely sell goods
  before entering them; the switch exists with its consequence stated.
- **Seeded defaults on signup.** Eleven units, three rate lists, six roles, one
  branch - so the first thing an owner does is add a product.

## Key decisions

| Decision | Reason |
|---|---|
| Money as integer paise | Floating point cannot represent 4.80; sums drift |
| Rate slabs embedded in one document | Makes "no overlaps" atomic, not hopeful |
| Ledger plus cached balance | Stock becomes explainable, not just a number |
| Conditional atomic decrement | Two terminals cannot both sell the last unit |
| Permission-based authorization | Businesses shape their own roles without code changes |
| Users global, membership per business | One accountant can serve two shops |
| Tenant guard as a Mongoose plugin | Isolation impossible to forget by omission |
| Access token in memory, refresh in httpOnly cookie | One XSS cannot become a permanent takeover |
| Pricing rules in `shared` | Preview and decision can never disagree |
| tsup bundles the API | Removes path-alias and extension friction in a TS monorepo |
| Plain fetch wrapper, not axios | The wrapper already covers what axios would add |

## Not in scope for v1

Decided with the product owner:

- GST compliance (HSN codes, CGST/SGST/IGST split, compliant invoice format).
  Products carry a single tax rate for reference; there is no tax engine.
- Batch and expiry tracking, and serial/IMEI tracking.
- Unit conversion between purchase and stock units.

## Testing

- `packages/shared`: unit tests for money, pricing slabs, document arithmetic,
  ageing, calendar ranges and payables.
- `apps/api`: integration tests start the real Express app on an ephemeral port
  against a throwaway MongoDB replica-set database (`shopos_test`, dropped before
  each run) and register fresh businesses through the public API, so every test also
  proves tenant isolation. Covered: tenancy, inventory, sales, purchasing, reports
  and security, plus unit tests for costing, CSV and statements.
- `apps/web`: unit tests for the formatting and parsing helpers.
- `scripts/smoke-test.sh`: 56 checks against a running server and the demo data.

## Deployment shape

One API process (Express, Mongoose) and static web assets. In `docker-compose.yml`
nginx serves the web build and forwards `/api` to the API, so the browser sees one
origin. MongoDB must be a replica set. Only one API instance should run the
background jobs (`JOBS_ENABLED`).
