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
    models/     18 Mongoose models
    plugins/    tenantGuard
    transaction.ts
  middleware/   authenticate, requirePermission, validate, errorHandler, rateLimiter
  modules/      auth, organizations, branches, users, roles, catalog,
                products, pricing, inventory, dashboard, audit, health
  services/     tokenService, inventoryService, auditService, counterService,
                organizationBootstrap
  seed/         demo data

apps/web/src/
  components/   ui primitives, PageHeader
  features/     auth, dashboard, products, pricing, inventory, admin
  hooks/        useBranches
  layouts/      AppShell
  lib/          apiClient, format, labels, queryClient, utils
  stores/       authStore

packages/shared/src/
  api, enums, money, pagination, permissions, pricing, validation
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

## The three engines

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

## Next

Phase 9 onwards: suppliers and purchase orders, goods receipts feeding the same
`applyMovement`, then customers, quotations, sales orders, invoices and payments.
Invoices will store the commercial values used at the time, so changing a rate
today can never rewrite the past.
