# ShopOS Business Rules

The rules the system enforces. Nothing here is enforced by the frontend alone -
every one of them is checked on the server.

Rules marked **[built]** are implemented and covered by `npm run smoke`.
The rest arrive with phases 9 to 12.

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

## Historical values are frozen (phases 9 to 12)

If a product costs Rs 10 today but an invoice from six months ago charged Rs 8,
that invoice shows Rs 8 forever.

- Every document line stores the commercial values used at the time: product
  name, SKU, unit, unit price, discount, tax rate and line total.
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

Still to cover with automated tests (Phase 16): concurrent decrements under real
parallel load, and the negative-stock setting in both positions.

## Purchasing (phase 9)

1. A purchase order is a commitment. It **does not** change stock.
2. Stock increases only on a goods receipt.
3. Receipts may be partial and repeated: order 1000, receive 700 now (stock +700),
   receive 300 later (stock +300).
4. Status follows receipts: `DRAFT -> SENT -> PARTIALLY_RECEIVED -> RECEIVED`.
5. Receiving more than the outstanding quantity is refused.

## Sales (phases 10 to 11)

1. Stages are not compulsory. A walk-in customer goes straight to an invoice; a
   B2B customer may go quotation, sales order, invoice, payment.
2. A quotation is an offer. A sales order is a promise. **The invoice is the
   event that moves stock and money.**
3. A sales order may be invoiced in parts.
4. Invoices are not deleted. They are cancelled, and a cancellation reverses the
   stock it moved.

## Payments (phase 12)

1. A payment is recorded against a customer and allocated across one or more
   invoices.
2. Invoice `paidAmount` and outstanding balance are derived from allocations, not
   typed in by hand.
3. Allocating more than an invoice's outstanding amount is refused.

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
