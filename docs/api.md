# ShopOS API

Base URL: `/api/v1`

## Response envelope

Every endpoint returns one of three shapes. Never a bare object, never a bare
array. One envelope means the client has exactly one place that understands
success, failure and paging.

**Success**

```json
{ "success": true, "data": {}, "message": "optional" }
```

**Paginated**

```json
{
  "success": true,
  "data": [],
  "pagination": { "page": 1, "limit": 25, "total": 100, "totalPages": 4 }
}
```

**Error**

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock for Natraj 621 Pencil. Available: 40 pcs, needed: 150 pcs",
    "details": [{ "field": "tiers.1", "message": "Slab overlaps the previous one" }]
  }
}
```

Clients switch on `error.code`, never on `error.message`. Codes are a contract;
messages are for humans and may be reworded or translated at any time. The full
list lives in `packages/shared/src/api.ts`.

## Authentication

| Token | Lifetime | Where it lives | Purpose |
|---|---|---|---|
| Access | 15 minutes | `Authorization: Bearer <token>` | Sent on every request |
| Refresh | 30 days | httpOnly cookie `shopos_rt` | Mints new access tokens |

The refresh token rotates on every use, and presenting an already-rotated token
revokes the whole session family - that pattern means a stolen token is usable
once at most before both parties are logged out.

Permissions are resolved from the database per request rather than read from the
token, so removing someone's access takes effect on their next call rather than
whenever their token happens to expire.

## Status codes

| Code | Used for |
|---|---|
| 200 | Successful read or update |
| 201 | Resource created |
| 400 | Malformed request or failed validation |
| 401 | Missing, invalid or expired authentication |
| 403 | Authenticated but not permitted |
| 404 | Does not exist, **or does not exist for this tenant** |
| 409 | Conflict - duplicate code, or the record changed while you were editing it |
| 413 | Request body over the 1 MB limit |
| 422 | Valid request that breaks a business rule |
| 429 | Rate limited |
| 500 | Unexpected server error |

A record belonging to another organization returns **404, not 403**. Answering
403 would confirm the record exists, which is information about another business.

## Pagination, sorting and search

Every list endpoint accepts the same parameters, defined once in
`packages/shared/src/pagination.ts`:

| Parameter | Default | Notes |
|---|---|---|
| `page` | 1 | 1-based |
| `limit` | 25 | Capped at 100 everywhere |
| `sortBy` | per endpoint | Checked against an allow-list |
| `sortOrder` | `desc` | `asc` or `desc` |
| `search` | none | Always server-side |

## Rate limits

| Scope | Limit |
|---|---|
| General | 300 requests / minute / IP (raise with `GENERAL_RATE_LIMIT`) |
| `/auth/login`, `/auth/register`, `/auth/google` | 10 per 15 min / IP, successes not counted |

---

# Endpoints

## Health

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/health` | - | Service and database status |
| GET | `/health/live` | - | Liveness |
| GET | `/health/ready` | - | 503 while the database is unreachable |

## Auth

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/auth/capabilities` | - | Whether Google sign-in is configured |
| POST | `/auth/register` | - | Creates user + business + branch + roles + rate lists + units |
| POST | `/auth/login` | - | Email and password |
| POST | `/auth/google` | - | Google ID token, verified server-side |
| POST | `/auth/refresh` | cookie | Rotates the refresh token |
| POST | `/auth/logout` | cookie | Revokes this device only |
| GET | `/auth/me` | signed in | Current user, role and permissions |
| GET | `/auth/organizations` | signed in | Businesses this person belongs to |
| POST | `/auth/switch-organization` | signed in | Move the session to another business |

## Organization

| Method | Path | Permission |
|---|---|---|
| GET | `/organizations/current` | signed in |
| PATCH | `/organizations/current` | `organization:manage` |

There is no route to fetch a business by id. The only business a request can read
is the one its own session is scoped to.

## Branches

| Method | Path | Permission |
|---|---|---|
| GET | `/branches` | `branches:view` |
| GET | `/branches/:id` | `branches:view` |
| POST | `/branches` | `branches:manage` |
| PATCH | `/branches/:id` | `branches:manage` |

No delete. Branches are deactivated, and only once their stock is zero.

## Staff and roles

| Method | Path | Permission |
|---|---|---|
| GET | `/users` | `users:view` |
| POST | `/users` | `users:manage` |
| PATCH | `/users/:id` | `users:manage` |
| GET | `/roles` | `users:view` |
| GET | `/roles/permissions` | signed in |
| POST | `/roles` | `roles:manage` |
| PATCH | `/roles/:id` | `roles:manage` |
| DELETE | `/roles/:id` | `roles:manage` |

The last active owner cannot be demoted or suspended, and the OWNER role cannot
be edited or deleted - otherwise a business could lock itself out permanently.

## Catalogue

Categories, brands and units share one implementation.

| Method | Path | Permission |
|---|---|---|
| GET | `/categories`, `/brands`, `/units` | `products:view` |
| POST | same | `products:create` |
| PATCH | `/:id` | `products:create` |
| DELETE | `/:id` | `products:create` |

Delete is refused while any product still references the record.

## Products

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/products` | `products:view` | `search`, `categoryId`, `brandId`, `status` |
| GET | `/products/:id` | `products:view` | Product + every rate card + stock at every branch |
| GET | `/products/upload-signature` | `products:create` | Signed Cloudinary upload params |
| POST | `/products` | `products:create` | Item code generated when omitted |
| PATCH | `/products/:id` | `products:update` | |
| POST | `/products/:id/archive` | `products:archive` | `{ isActive }`. Never deletes |

**Search order:** exact item code or barcode first, then a full-text match over
name, code, brand and category, then a partial-word pattern match. All three run
in MongoDB.

## Pricing

| Method | Path | Permission |
|---|---|---|
| GET | `/pricing/lists` | `pricing:view` |
| POST | `/pricing/lists` | `pricing:create` |
| PATCH | `/pricing/lists/:id` | `pricing:update` |
| GET | `/pricing/resolve` | `pricing:view` |
| GET | `/pricing/recent` | `pricing:view` |
| PUT | `/pricing/products/:productId` | `pricing:update` |
| DELETE | `/pricing/products/:productId/:priceListId` | `pricing:delete` |

**`GET /pricing/resolve?productId=…&quantity=150[&priceListId=…]`** is the
pricing engine. It returns the one applicable slab, or 422 with a clear reason -
never a fallback price.

```json
{
  "success": true,
  "data": {
    "productName": "Natraj 621 Pencil",
    "quantity": 150,
    "unitPricePaise": 420,
    "lineTotalPaise": 63000,
    "appliedTier": { "range": "100+", "minQuantity": 100, "maxQuantity": null }
  }
}
```

**`PUT /pricing/products/:productId`** replaces the whole rate card in one
atomic write. Overlapping slabs, gaps, a card that does not start at 1, or more
than one open-ended slab are all refused with 422 and `OVERLAPPING_PRICE_TIERS`.

## Inventory

| Method | Path | Permission |
|---|---|---|
| GET | `/inventory/stock` | `inventory:view` |
| GET | `/inventory/summary` | `inventory:view` |
| GET | `/inventory/movements` | `inventory:view` |
| POST | `/inventory/adjustments` | `inventory:adjust` |
| POST | `/inventory/opening-stock` | `inventory:adjust` |
| GET | `/inventory/transfers` | `inventory:view` |
| GET | `/inventory/transfers/:id` | `inventory:view` |
| POST | `/inventory/transfers` | `inventory:transfer` |
| POST | `/inventory/transfers/:id/receive` | `inventory:transfer` |
| POST | `/inventory/transfers/:id/cancel` | `inventory:transfer` |

Adjustments take the **counted quantity**, not the difference - the change is
worked out server-side and written to the ledger.

Transfers are two-step. Creating one removes stock from the source and sets
`IN_TRANSIT`; receiving adds it at the destination. A receive may record less
than was sent, and the shortfall stays visible on the document.

Insufficient stock returns 422 `INSUFFICIENT_STOCK` with the available and
requested quantities in the message.

## Customers

| Method | Path | Permission |
|---|---|---|
| GET | `/customers` | `customers:view` (`search`, `withBalance`) |
| GET | `/customers/:id` | `customers:view` |
| GET | `/customers/:id/summary` | `customers:view` |
| GET | `/customers/:id/statement` | `customers:view` (`from`, `to`) |
| POST | `/customers` | `customers:manage` |
| PATCH | `/customers/:id` | `customers:manage` |

The summary gives billed, paid, returned, outstanding, overdue, `refundDuePaise`
and `netBalancePaise`. The statement is a dated ledger with a running balance and
an opening balance for anything before `from`.

## Sales documents

Money is paise throughout.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/quotations`, `/quotations/:id` | `sales:view` | Status `EXPIRED` is derived from the date |
| POST | `/quotations` | `sales:create` | |
| PUT | `/quotations/:id` | `sales:update` | Drafts only |
| POST | `/quotations/:id/send`, `/accept`, `/reject` | `sales:update` | Status transitions |
| POST | `/quotations/:id/extend` | `sales:update` | New valid-until date |
| POST | `/quotations/:id/convert-to-order` | `sales:create` | Once only |
| POST | `/quotations/:id/convert-to-invoice` | `sales:create` | Once only |
| GET | `/sales-orders`, `/sales-orders/:id` | `sales:view` | |
| POST | `/sales-orders` | `sales:create` | |
| PUT | `/sales-orders/:id` | `sales:update` | Drafts only |
| POST | `/sales-orders/:id/confirm` | `sales:update` | |
| POST | `/sales-orders/:id/cancel` | `sales:cancel` | |
| POST | `/sales-orders/:id/invoice` | `sales:create` | Partial invoicing: send the lines and quantities |
| GET | `/invoices`, `/invoices/:id` | `sales:view` | `status`, `customerId`, `overdue`, `outstandingOnly`, `from`, `to`, `q` |
| POST | `/invoices` | `sales:create` | `items`, discounts, `creditDays`, optional pay-now |
| POST | `/invoices/:id/cancel` | `sales:cancel` | Reverses stock; refused once paid |
| GET | `/sales-returns`, `/sales-returns/:id` | `sales:view` | |
| POST | `/sales-returns` | `sales:return` | Against one invoice; may include a refund |

Line items carry `productId`, `quantity` and optionally `discountPercent`; the rate
comes from the pricing engine for the quantity, never from the client. Fields not
declared by the schema (`paidPaise`, `status`, `organizationId`) are ignored.

## Payments

| Method | Path | Permission |
|---|---|---|
| GET | `/payments` | `payments:view` (`customerId`, `method`, `status`, `from`, `to`, `q`) |
| GET | `/payments/outstanding-invoices` | `payments:view` |
| GET | `/payments/:id` | `payments:view` |
| POST | `/payments` | `payments:create` |
| POST | `/payments/:id/void` | `payments:void` (`reason`) |

## Suppliers and purchasing

| Method | Path | Permission |
|---|---|---|
| GET | `/suppliers` | `suppliers:view` |
| GET | `/suppliers/:id/summary` | `suppliers:view` |
| GET | `/suppliers/:id/statement` | `suppliers:view` |
| POST | `/suppliers` | `suppliers:manage` |
| PATCH | `/suppliers/:id` | `suppliers:manage` |
| GET | `/purchase-orders`, `/purchase-orders/:id` | `purchases:view` |
| POST | `/purchase-orders` | `purchases:create` |
| POST | `/purchase-orders/:id/send` | `purchases:update` |
| POST | `/purchase-orders/:id/cancel` | `purchases:update` |
| POST | `/purchase-orders/:id/receive` | `purchases:receive` |
| GET | `/purchase-returns`, `/purchase-returns/:id` | `purchases:view` |
| POST | `/purchase-returns` | `purchases:return` |
| GET | `/supplier-payments`, `/supplier-payments/:id` | `purchases:view` |
| GET | `/supplier-payments/payable-orders` | `purchases:view` |
| POST | `/supplier-payments` | `purchases:pay` |
| POST | `/supplier-payments/:id/void` | `purchases:pay` |

Receiving more than is outstanding returns 422. Returns and payments are bounded
by what was received and what is owed.

## Notifications

Signed-in users only; each person sees what their permissions allow.

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | Paginated |
| GET | `/notifications/summary` | Unread count, for the bell |
| POST | `/notifications/:id/read` | |
| POST | `/notifications/read-all` | |

## Reports

Need `reports:view`. `GET /reports` lists what the caller may run;
`GET /reports/:key` runs one. Add `format=csv` for a download.

| Key | Filters | Notes |
|---|---|---|
| `sales-summary` | period, branch, `groupBy` day / month / product / customer / branch | Margin only with `costs:view` |
| `tax-summary` | period, branch | Tax by rate, after returns |
| `collections` | period, branch, `groupBy` method / day / branch | |
| `receivables-aging` | branch | Who owes us, by lateness |
| `payables-aging` | branch | Whom we owe |
| `purchases-summary` | period, branch, `groupBy` month / day / supplier / branch | |
| `stock-valuation` | branch, `groupBy` product / branch / category | Needs `costs:view` |
| `reorder` | branch | At or below reorder level |

A report is `{ key, title, columns: [{ key, label, type }], rows, totals, period }`.

## Dashboard and audit

| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard` | `products:view` |
| GET | `/audit-logs` | `audit_logs:view` |

The dashboard returns today's and the month's sales and collections, a 14-day
trend, receivables and payables with overdue amounts, low stock, top products,
recent invoices and what needs attention. Parts the caller may not see (payables,
cost, margin) are omitted or null rather than zero.

The audit log has no create, update or delete route, and never will.
