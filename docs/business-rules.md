# ShopOS Business Rules

The rules the system enforces. Nothing here is enforced by the frontend alone -
every one of them is checked on the server.

Every rule here is implemented. The integration specs in `apps/api/src/test` and the
arithmetic specs in `packages/shared/src/__tests__` assert them against the real
app, and `npm run smoke` walks the main flows end to end.

## Pricing **[built]**

1. There is **no single `product.price` field**. A product is priced through a
   price list, and it may be priced differently under each one.
2. Default price lists are RETAIL, WHOLESALE and DEALER. An organization may add
   its own.
3. A price under a list carries **quantity tiers**:

   ```
   Retail            Wholesale
   1-9    Rs 5.00    1-49    Rs 4.70
   10-49  Rs 4.80    50-199  Rs 4.40
   50-99  Rs 4.50    200+    Rs 4.10
   100+   Rs 4.20
   ```

4. Tiers must not overlap. Because tiers are embedded in the price document, the
   whole set is validated in one atomic write, so an overlap cannot be created by
   a partial update.
5. The final tier may be open-ended (`100+`).
6. The pricing engine is **deterministic**: given a product, a price list and a
   quantity, exactly one tier applies. There is no fallback guessing.
7. A quantity with no matching tier is an error the caller sees, not a silently
   substituted price.
8. An inactive price list is never used to price anything.
9. Every price change is audited with its before and after values.
10. Changing a price today **never** rewrites a historical document.

**Verified by `npm run smoke`:** quantities 1, 9, 10, 49, 50, 99, 100 and 5000
each resolve to the correct slab; overlapping slabs, gaps and a card that does not
start at 1 are all refused with 422; a quantity of zero is refused.

## Money

1. Every amount is an **integer number of paise**. There is no floating-point
   rupee anywhere in storage, arithmetic or the API.
2. A line is worked out in one order everywhere (`computeLineAmounts`, shared by
   server and browser): gross = rate x quantity, less the discount, then tax on
   what is left.
3. When part of a line is returned, the credit is the *cumulative* proportional
   share of the line total, minus what was already credited, so the pieces always
   add up to the whole whatever the rounding.
4. Dates that mean "a day" (due dates, report ranges, list filters) are calendar
   days in the **shop's timezone**, not UTC. A bill raised at 11 pm on the 31st is
   in that month.

## Historical values are frozen **[built]**

If a product costs Rs 10 today but an invoice from six months ago charged Rs 8,
that invoice shows Rs 8 forever.

- Every document line stores the commercial values used at the time: product
  name, SKU, unit, unit price, discount, tax rate, line total and the unit cost.
- Displaying a historical document **never** reads the current product price.
- Renaming or repricing a product does not alter any document already written.

## Inventory **[built]**

1. Stock is **per branch**. Natraj Pencil is 1200 at Bhagalpur, 300 at Patna and
   850 at Ranchi - it is not one number.
2. Every movement is written to an append-only ledger:
   `PURCHASE`, `SALE`, `SALE_RETURN`, `PURCHASE_RETURN`, `DAMAGE`, `ADJUSTMENT`,
   `TRANSFER_OUT`, `TRANSFER_IN`, `OPENING_STOCK`.
3. The balance document is a cached total. The ledger is the source of truth, and
   the balance must always be reconstructable from it.
4. Stock never goes negative unless the organization explicitly allows it.
5. Decrements use a single conditional atomic update, so two simultaneous sales
   of the last unit cannot both succeed.
6. Adjustments always carry a reason. Without a legitimate way to correct a
   count, staff invent illegitimate ones.
7. Transfers are two-step: `TRANSFER_OUT` at the source, `IN_TRANSIT`, then
   `TRANSFER_IN` on receipt. Goods on a truck belong to neither branch.
8. Operations spanning several documents use MongoDB transactions.

**Verified by `npm run smoke`:** an adjustment moves stock to the counted figure
and records who and why; a transfer removes from the source, leaves the
destination unchanged while in transit, and adds on receipt; sending more than is
in stock is refused with 422; every movement appears in the ledger.

`inventory.test.ts` also fires parallel sales at the last units and asserts exactly
the available quantity is sold, and exercises the negative-stock setting both ways.
Low-stock and out-of-stock alerts are raised from `applyMovement`, so no route can
change stock without them.

## Costs and margin **[built]**

1. A product's cost is a **moving average**: each goods receipt weights what was
   already on hand against what just arrived. It is worked out *before* the stock
   is increased, otherwise the new goods would be counted twice.
2. Each invoice line freezes the cost at the moment of sale, so a later purchase
   never rewrites a past margin.
3. Cost, margin and stock value are visible only with `costs:view`. Everyone else
   receives responses that do not contain the fields at all.

## Purchasing **[built]**

1. A purchase order is a commitment. It **does not** change stock.
2. Stock increases only on a goods receipt.
3. Receipts may be partial and repeated: order 1000, receive 700 now (stock +700),
   receive 300 later (stock +300). Receiving more than is outstanding is refused.
4. Status follows receipts: `DRAFT -> SENT -> PARTIALLY_RECEIVED -> RECEIVED`.
5. **What we owe a supplier is what has been delivered**, not what was ordered:
   value received, less goods returned, less payments made.
6. A supplier payment is allocated to purchase orders and bounded by what may still
   be paid. A deposit before delivery is allowed up to the order total.
7. Credit terms give each order a due date (end of that day in the shop's
   timezone). Payment status is `UNPAID`, `PARTIALLY_PAID` or `PAID`.
8. Goods sent back reduce stock and the amount owed. If the supplier was paid more
   than the reduced order is worth, the surplus shows as credit due from them.
9. A supplier payment is voided, never deleted, with a reason.

## Sales **[built]**

1. Stages are not compulsory. A walk-in customer goes straight to an invoice; a
   B2B customer may go quotation, sales order, invoice, payment.
2. A quotation is an offer and a sales order is a promise. Neither moves stock or
   money. **The invoice is the event that does.**
3. Quotations expire at the end of their valid-until day; "expired" is derived from
   the date, not stored, so it can never be stale. An expired quotation can be
   extended but not converted.
4. A quotation converts to an order or straight to an invoice exactly once, claimed
   with a conditional update so two clicks cannot create two documents.
5. A sales order may be invoiced in parts. What remains to invoice is derived from
   the invoices raised against it.
6. Discounts above the organization's threshold need the discount permission.
7. With credit-limit enforcement on, an invoice that would take a customer past
   their limit is refused.
8. An invoice may take payment at the till ("pay now"), which is recorded exactly
   as a separate payment would be.
9. Invoices are not deleted. They are cancelled, and a cancellation reverses the
   stock it moved. An invoice with payments recorded cannot be cancelled directly.

## Returns and refunds **[built]**

1. A return is against one invoice and takes back at most what was sold less what
   was already returned.
2. Returned stock goes back on the shelf through the ledger (`SALE_RETURN`).
3. The credit reduces the invoice's outstanding amount. Where the customer has
   already paid more than the reduced invoice, the excess is **refund due**.
4. A refund is bounded by refund due and recorded against the invoice; it can never
   exceed what has been paid and returned.
5. Credit is a whole-paise cumulative share, so several partial returns of one line
   sum exactly to the line total.

## Payments **[built]**

1. A payment is recorded against a customer and allocated across one or more
   invoices; unallocated money is refused rather than parked.
2. Invoice `paidPaise`, outstanding balance and status are derived from payments,
   never typed in by hand.
3. Allocating more than an invoice's outstanding amount is refused.
4. Balances change with a compare-and-swap on the figure that was read, so two
   people recording against the same invoice cannot both succeed past the total.
5. A payment is **voided**, not deleted: a reason is recorded, the allocation is
   reversed and the invoice status re-derived.

## Receivables and statements **[built]**

1. A customer's balance is invoices, less payments, less returns, plus refunds
   paid. The statement and the summary come from the same figures and must agree;
   `refundDuePaise` and `netBalancePaise` expose the sign-flipped case.
2. Ageing buckets are current, 1-30, 31-60, 61-90 and over 90 days late. A bill is
   one day late the morning after its due day, not zero.
3. Supplier statements work the same way with the roles reversed.

## Notifications **[built]**

1. Low stock, out of stock, overdue invoices, bills falling due, incoming transfers
   and expiring quotations raise notifications for people who hold the relevant permission.
2. Each carries a dedupe key, so a condition is announced once until it clears, not
   every hour.
3. Read state is per user. An hourly job sweeps for overdue items; set
   `JOBS_ENABLED=false` on all but one API instance.

## Reports **[built]**

1. Reports take a period (a calendar range in the shop's timezone, at most three
   years) and, where it makes sense, a branch, and respect the caller's branches.
2. Margin and stock valuation require `costs:view`.
3. Every report can be exported as CSV. Text cells that start with `=`, `+`, `-` or
   `@` are prefixed so a spreadsheet reads them as text, not a formula.

## Authorization **[built]**

1. Authorization is **permission-based**. No code branches on a role name.
2. Roles are editable per organization; the system roles are seeded starting
   points, not fixed behaviour.
3. Branch-scoped users only see and act on their assigned branches.
4. Discounts beyond a threshold and downward stock adjustments need their own
   permissions - these are the two places where retail fraud actually happens.

## Audit **[built]**

Audited actions include: `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRICE_CREATED`,
`PRICE_UPDATED`, `PRICE_DELETED`, `INVENTORY_ADJUSTED`, `STOCK_TRANSFER_CREATED`,
`PURCHASE_CREATED`, `GOODS_RECEIVED`, `SALE_CREATED`, `INVOICE_CREATED`,
`PAYMENT_CREATED`, `USER_CREATED`, `ROLE_CHANGED`.

Each entry records who, what, when, which organization, which entity, and - where
it matters - the before and after values.


## Staff and access **[built]**

1. A staff member is a **membership** - the join between a global person and one
   business - which is what lets one accountant serve two shops.
2. Branch-scoped staff see and act on only their assigned branches. Requesting
   another branch returns 404, not 403.
3. A business must always keep at least one active owner. The last one cannot be
   demoted or suspended.
4. The OWNER role cannot be edited or deleted, so a business cannot lock itself
   out of its own account.
5. A role cannot be deleted while anyone still holds it.
6. Changing someone's role or branches takes effect on their very next request,
   not when their token expires.

## Branches **[built]**

1. Every business has one main branch, created at signup.
2. The main branch cannot be deactivated.
3. A branch holding stock cannot be deactivated - transfer it out first, so the
   goods are accounted for rather than disappearing with the branch.
4. Branches are never deleted. Every stock movement ever recorded points at one.
