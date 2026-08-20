# ShopOS Database Design

Status: **implemented through Phase 8.** 18 collections exist; the sales,
purchasing and finance collections arrive with phases 9 to 12.

## Engine settings

Applied at connection time in `apps/api/src/config/database.ts`:

| Setting | Value | Why |
|---|---|---|
| `strictQuery` | on | An unknown field in a filter is an error, not a silent match-everything |
| `autoIndex` | off in production | Index builds on boot can lock a live collection |

`sanitizeFilter` is deliberately **not** enabled. The reasoning is in
`security.md` under "Query-operator injection" - the short version is that Zod
already rejects the attack one step earlier, and enabling it would silently break
every legitimate `$in` and `$gte` the application builds.

Multi-document transactions need a replica set. The API detects the topology at
startup, logs a warning when they are unavailable, and shows it on
**Administration → System Status**.

## Collections

### Built (18)

**Tenancy and identity**

| Collection | Purpose |
|---|---|
| `organizations` | One business. The tenant root |
| `branches` | Shops and godowns that hold stock |
| `users` | Global person, unique by email |
| `memberships` | user × organization × role × branches |
| `roles` | Editable permission bundles, per business |
| `sessions` | Signed-in devices, holding hashed refresh tokens |
| `counters` | Atomic document numbering |

**Catalogue**

| Collection | Purpose |
|---|---|
| `categories`, `brands`, `units` | Small named lists |
| `products` | The catalogue. Embeds images and barcodes |

**Pricing**

| Collection | Purpose |
|---|---|
| `price_lists` | Retail, wholesale, dealer, and anything the owner adds |
| `product_prices` | One rate card per product per list. **Embeds the slabs** |

**Inventory**

| Collection | Purpose |
|---|---|
| `inventory_balances` | Cached quantity per product per branch |
| `inventory_transactions` | The append-only stock ledger |
| `stock_adjustments` | Correction documents, with embedded lines |
| `stock_transfers` | Branch-to-branch movement, with embedded lines |

**Platform**

| Collection | Purpose |
|---|---|
| `audit_logs` | Who changed what, and what it was before |

### Planned

`suppliers`, `purchase_orders`, `goods_receipts`, `customers`, `quotations`,
`sales_orders`, `invoices`, `credit_notes`, `payments`, `notifications`,
`idempotency_keys`, `daily_sales_rollups`.

Payment methods stay an organization setting rather than a collection - it is
configuration, and a collection would add a lookup to every payment read.

## Embed or reference

The rule: **embed when the child has no life of its own and is always read with
its parent; reference when the child is independently queried, independently
updated, or unbounded.**

### Embedded, and why

| In | What | Reason |
|---|---|---|
| `products` | `images[]`, `barcodes[]` | Bounded and always read together. A barcode scan still uses an index - MongoDB indexes fields inside arrays |
| `product_prices` | `tiers[]` | **The most important one.** Slabs are only valid as a complete set. Embedding makes replacing a rate card a single atomic write, so overlapping slabs cannot exist in the database even if the process dies mid-request |
| `stock_adjustments` | `items[]` | A count session is bounded and read as one document |
| `stock_transfers` | `items[]` | Same |

Arrays are capped and validated: 20 barcodes, 8 images, 20 slabs, 500 document
lines.

### Referenced, and why

| Reference | Reason |
|---|---|
| product → category, brand, unit | Edited independently, shared by thousands of products |
| inventory → product, branch | A product exists once; its stock exists per branch. A per-branch array inside the product would make every sale at any branch contend on one document |
| membership → user, organization, role | Identity is global, authority is per business |

`brandName`, `categoryName`, `unitName` and `unitSymbol` are **deliberately
copied onto the product** so a search result renders without extra lookups. The
catalogue service updates the copies when a brand or category is renamed. This is
intentional duplication for read speed, recorded here so it stays a decision.

### Always separate

`inventory_transactions` and `audit_logs` grow without bound and must stay
independently queryable. No unbounded array lives inside any document.

## Money

Every monetary value is an **integer number of paise**. Rs 4.80 is `480`.

Binary floating point cannot represent 4.80 exactly, and summing thousands of
such values drifts. Integers are exact and JavaScript handles them safely to
about Rs 90 trillion. Conversion happens only at the edges - parsing what a user
typed, and formatting for display. Helpers are in
`packages/shared/src/money.ts`.

## Indexing

Every compound index leads with `organizationId`. Without that, one large
tenant's queries scan another tenant's documents.

| Collection | Index | Serves |
|---|---|---|
| `products` | `{organizationId, sku}` unique | Item codes unique per business, not globally |
| `products` | `{organizationId, "barcodes.code"}` | Barcode scan, one indexed lookup |
| `products` | text on name, sku, brandName, categoryName | "natraj pencil" |
| `products` | `{organizationId, isActive, name}` | The listing screen |
| `product_prices` | `{organizationId, productId, priceListId}` unique | Prevents two competing rate cards |
| `inventory_balances` | `{organizationId, branchId, productId}` unique | Makes the atomic upsert safe |
| `inventory_transactions` | `{organizationId, productId, occurredAt}` | Product movement history |
| `inventory_transactions` | `{organizationId, branchId, occurredAt}` | Branch activity |
| `audit_logs` | `{organizationId, entityType, entityId, createdAt}` | History of one record |
| `sessions` | `{expiresAt}` TTL | MongoDB expires old sessions itself |

## Concurrency

**Stock is never read, modified and written back.** Two terminals selling the
last five units would both succeed. Every decrement is one conditional atomic
operation:

```js
findOneAndUpdate(
  { organizationId, branchId, productId, quantity: { $gte: requested } },
  { $inc: { quantity: -requested } },
)
```

No match means insufficient stock, decided atomically, with no lock. This lives
in `applyMovement` in `apps/api/src/services/inventoryService.ts`, which is the
only code in the system that writes to `inventory_balances`.

Document numbers (`ADJ-2026-000042`, `TRF-2026-000007`) come from the `counters`
collection via `findOneAndUpdate` with `$inc`, never from `count() + 1`.

## Tenant isolation

A Mongoose plugin (`db/plugins/tenantGuard.ts`) throws on any query against an
organization-owned collection that lacks an `organizationId` filter. Legitimate
cross-tenant reads - looking up a user by email at login - opt out explicitly
with `.setOptions({ allowCrossTenant: true })`.

This caught three real bugs during development: `populate()` resolves by `_id`
alone and so produces an unscoped query. Those were replaced with explicit
tenant-scoped lookups.

Aggregation pipelines are not covered by the plugin. They must `$match` on
`organizationId` as their first stage, which is a review responsibility.

## Deletion policy

| Kind of record | Policy |
|---|---|
| Products, customers, suppliers | `isActive` flag. Archived, never deleted - transactions reference them forever |
| Branches | Deactivated, and only when holding no stock |
| Transactional documents | Status transitions (`CANCELLED`). Never deleted |
| Categories, brands, units | Hard delete, but only when no product references them |
| Audit logs, ledger rows | Append-only. No delete path exists |
