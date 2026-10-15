# ShopOS Security

## In place

### Authentication

| Control | Where |
|---|---|
| bcrypt password hashing, cost 12 | `modules/auth/auth.service.ts` |
| Access tokens are short-lived (15 min) and carry only ids | `services/tokenService.ts` |
| Refresh tokens are 64 random bytes, stored only as SHA-256 hashes | `services/tokenService.ts` |
| Refresh rotation on every use | `auth.service.ts` |
| **Reuse detection** - a replayed refresh token revokes the whole session family | `auth.service.ts` |
| Refresh token in an httpOnly, sameSite=lax cookie, never in localStorage | `tokenService.ts`, `stores/authStore.ts` |
| Session revocation checked on every request | `middleware/authenticate.ts` |
| Google ID tokens verified server-side against Google's keys **and our client id** | `auth.service.ts` |
| Identical response and identical work for unknown email vs wrong password | `auth.service.ts` |
| 10 attempts per 15 minutes on every credential route | `middleware/rateLimiter.ts` |

### Authorization

| Control | Where |
|---|---|
| Permission-based, never role-name checks | `middleware/requirePermission.ts` |
| Permissions read from the database per request, not from the token | `middleware/authenticate.ts` |
| Permission cache invalidated immediately on a role or membership change | `authenticate.ts`, `users.service.ts` |
| Branch scoping enforced on every operation naming a branch | `core/tenantContext.ts` |
| Last active owner cannot be demoted or suspended | `users.service.ts` |
| OWNER role cannot be edited or deleted | `roles.routes.ts` |

### Tenant isolation

| Control | Where |
|---|---|
| Tenant identity derived from the session, never from the request body | `middleware/authenticate.ts` |
| Mongoose plugin throws on any unscoped query | `db/plugins/tenantGuard.ts` |
| Every client-supplied reference re-validated as belonging to the caller's business | services |
| Cross-tenant records return 404, not 403 | services |

The guard is not theoretical: it caught three live bugs during development where
`populate()` produced an unscoped `find` on Branch, Product and PriceList. Each
was replaced with an explicit tenant-scoped lookup.

### Money and documents

| Control | Where |
|---|---|
| Money is integer paise end to end; no floating-point rupee is ever stored | `packages/shared/src/money.ts` |
| Every balance change is a compare-and-swap on the amount that was read, so two people paying the same bill at once cannot both win | `payments.service.ts`, `supplierPayments.service.ts`, `salesReturns.service.ts`, `purchaseReturns.service.ts` |
| Multi-document changes (invoice + stock + payment + return) run in one transaction | `db/transaction.ts` |
| Stock only changes through one function that writes the append-only ledger | `services/inventoryService.ts` |
| Unit cost and margin are hidden from anyone without `costs:view`, in lists, details, invoices and reports | `products.service.ts`, `invoicePresenter.ts`, `reports.service.ts` |
| A payment is never edited or deleted; it is voided, with a reason, which reverses its effect | `payments.service.ts` |
| Refunds cannot exceed what has been paid and returned | `salesReturns.service.ts` |
| Report CSVs prefix any cell starting `=`, `+`, `-`, `@`, tab or CR so a customer named like a formula cannot run in a spreadsheet | `modules/reports/csv.ts` |
| A body over 1 MB is refused with 413, and unparseable JSON with 400, instead of surfacing as a server error | `middleware/errorHandler.ts` |
| List date filters are calendar days in the shop's timezone, so an 11 pm sale on the 31st is in October | `core/calendar.ts` |

### Input handling

| Control | Where |
|---|---|
| Zod allow-list schemas on every body, query and route parameter | `middleware/validate.ts` |
| Mass assignment blocked - undeclared fields do not survive parsing | same |
| Regex metacharacters escaped in every search term | `core/listQuery.ts` |
| Sort fields checked against an allow-list | `core/listQuery.ts` |
| Page size capped at 100 on every endpoint | `packages/shared/src/pagination.ts` |
| 1 MB request body limit | `app.ts` |

### Transport and process

| Control | Where |
|---|---|
| Helmet security headers (CSP, HSTS, nosniff, frame options) | `app.ts` |
| CORS allow-list, absolute in production | `app.ts` |
| Environment validated at startup; the process refuses to boot on bad config | `config/env.ts` |
| Production boot fails on placeholder or short JWT secrets | `config/env.ts` |
| Authorization headers, cookies, passwords and tokens redacted from logs | `core/logger.ts` |
| Stack traces and driver messages never reach a client | `middleware/errorHandler.ts` |
| Correlation id on every request and every log line | `middleware/requestLogger.ts` |
| `.env` gitignored; no secret in the repository | `.gitignore` |

### Audit

Every meaningful change writes an append-only entry with who, what, when, which
business, which record, and the fields that changed with their previous values.
There is no update or delete route for `audit_logs`, and there will not be.

---

## Query-operator injection: a deliberate decision

The attack is real. A login body of `{"email": {"$gt": ""}}` would, without
defence, match the first user in the collection.

ShopOS blocks it **at the boundary**: every body, query string and route
parameter is parsed by a Zod schema before any service runs, and `z.string()`
rejects an object outright. The smoke test asserts this - that request returns
400.

Mongoose's `sanitizeFilter` was tried as a second layer and removed. It wraps
*every* object-valued filter in `$eq`, including the many legitimate ones the
application builds itself (`{ _id: { $in: ids } }`, `{ quantity: { $gte: 5 } }`).
Those stop matching unless each is individually wrapped in `mongoose.trusted()`,
and a forgotten wrapper produces a query that silently returns nothing rather
than an error. Given the validation already in place, that failure mode is more
dangerous than the attack it prevents.

If it is ever re-enabled, every operator query in the codebase must be wrapped at
the same time.

---

## Standing rules

1. Tenant identity is never taken from the client.
2. Every referenced id in a payload is re-validated against the caller's
   organization. A valid id from another tenant is the most common real-world
   multi-tenant bug.
3. A record from another organization returns 404, not 403.
4. Validation schemas are allow-lists.
5. Permissions are resolved server-side per request.
6. Never returned to a client: password hashes, refresh tokens, internal
   secrets, database credentials, stack traces.
7. Frontend permission checks hide buttons. The backend check protects data.
8. Audit logs are append-only.

---

## Known gaps

| Item | Status |
|---|---|
| Rate limiting is per-process and in-memory | Must move to a shared store before running multiple instances, or the effective limit multiplies by instance count. Deployment phase |
| Permission cache is per-process | With several instances, a revocation clears one instance immediately and the others within 15 seconds |
| Email verification and password reset | Architected but not built - no mail transport is configured |
| Staff accounts are created with a password handed over directly | Replaced by an email invitation flow once mail is configured |
| No CSRF token | Currently unnecessary: the refresh cookie is `sameSite=lax` and every state-changing route requires a Bearer token that a cross-site page cannot read. Revisit if cookie-only authentication is ever added |
| MongoDB must be a replica set | Transactions require one. `npm run db:local` starts a private single-node set for development; Atlas and the Docker compose file provide one in production |
| `esbuild` low-severity advisory (GHSA-g7r4-m6w7-qqqr) | Transitive via Vite and tsup. Affects esbuild's own dev server on Windows, which ShopOS never runs. No production exposure. An npm override does not take against Vite's pin |
| Dependency scanning | `npm audit` runs in CI and fails the build on high-severity advisories |
| Background jobs run inside the API process | The overdue sweep is guarded by a unique `dedupeKey`, so two instances cannot double-notify, but both will do the work. Set `JOBS_ENABLED=false` on all but one instance |

---

## Verification

`apps/api/src/test/security.test.ts` is run on every build. It asserts, against the
real app:

- every data endpoint answers 401 without a token, and with a forged one;
- counter staff get 403 on reports, users, roles, the audit log and purchasing;
- cost price never appears in a response for someone without `costs:view`;
- a member cannot promote themselves;
- extra fields (`organizationId`, `paidPaise`, `status`) in a body are ignored;
- operators in query strings, malformed ids and regex-bomb searches are harmless;
- oversize bodies get 413 and errors carry no stack or driver wording;
- security headers are present and a foreign `Origin` is refused;
- a formula-like customer name is neutralised in a CSV export.

`tenancy.test.ts` covers the cross-business cases: every id that belongs to another
shop must behave exactly like an id that does not exist.

### Found and fixed during the review

- A request body over the size limit, or malformed JSON, was reported as a 500.
  It is now 413 / 400 (`errorHandler.ts`).
- Invoice, payment and return lists treated a "to" date as the end of a UTC day, so
  late-evening Indian sales fell into the next day's filter. They now use the shop's
  timezone.
