# Presenting ShopOS: setup, demo script and review questions

A guide for showing the project to a teacher or reviewer. About ten minutes of
demo, then questions.

---

## 1. Before you present (15 minutes ahead)

You need three things running. Use three terminals, in the project folder.

**Terminal 1 - the database** (a local MongoDB replica set; leave it open)

```bash
npm run db:local
```

**Terminal 2 - fresh demo data, then the app**

```bash
npm run seed
npm run demo-data
npm run dev
```

`seed` rebuilds the demo business (Gupta Traders: 3 branches, 8 products, customers
and suppliers). It prints the owner and sales-staff logins when it finishes - keep
that output visible. `demo-data` then creates a few days of realistic activity
through the real API: purchases, credit sales, a part-payment, a return, a cancelled
invoice, a quotation and a sales order. That is what makes the dashboard and
reports show real numbers instead of zeros.

Use the `MONGODB_URI` from `apps/api/.env` if you have a working online (Atlas)
database; otherwise set it to the local one:

```
MONGODB_URI=mongodb://127.0.0.1:27018/shopos?replicaSet=rs0
```

Then open <http://localhost:5173>.

**Run `npm run seed` then `npm run demo-data` again before every presentation.**
Each demo run changes stock and balances, and `demo-data` should be run once per seed.

**Checklist**

- [ ] Sign in as the owner; the dashboard shows sales, "owed to you" and "you owe"
- [ ] Open a second private window and sign in as the sales-staff user (for the access demo)
- [ ] `npm test` passes (needs Terminal 1 running). Have the result ready to show
- [ ] Browser zoom at 110-125% so the back of the room can read it
- [ ] The repository open in your editor, on `packages/shared/src/sales.ts`

---

## 2. The ten-minute demo

### Opening (30 seconds)

> "ShopOS is a multi-tenant ERP for Indian wholesale and retail shops. It answers
> one question for every member of staff at every branch: *what does this cost
> right now, and how many do we have?* - and then carries on to selling, billing,
> collecting money, returns and reordering."

Point at the sidebar: it is the whole business in the order a shopkeeper works.
Labels are bilingual (English and Hindi) because that is how the users talk.

### Step 1 - the core question: price and stock (1.5 min)

1. In the search box type **Natraj**. Show the result appears as you type, and that
   half-typed words work.
2. Open the product. Show **rate slabs** under Retail / Wholesale / Dealer and the
   **stock at each branch**.
3. Use the **rate calculator**: "how much for 150?" -> the 100+ slab applies.

> "There is no single price field. A price belongs to a price list and has quantity
> slabs. Overlaps, gaps and a card that doesn't start at 1 are refused, and the same
> validation code runs in the browser and on the server."

### Step 2 - selling (2 min)

1. **Sales -> New invoice**. Pick *Bansal Book Depot*, add Natraj pencils (150).
   Show the rate is picked automatically for the quantity, add a discount.
2. Save it. Show the invoice: due date from the customer's **credit days**, tax,
   total. Click **Print** (clean print layout).
3. Go back to the product: stock has dropped.

> "The invoice is the event that moves stock and money. Quotations and sales orders
> are only offers and promises. Every line stores the rate, tax and cost at the
> moment of sale, so changing a price tomorrow never rewrites yesterday's invoice."

### Step 3 - money in, and what happens when things go wrong (2 min)

1. Open *Sharma Stationers* (Customers). Show the **statement**: running balance,
   part-payment, what is outstanding and how late.
2. **Record payment** on an unpaid invoice; try to pay *more* than is owed - it is
   refused.
3. Open the *Vidya Mandir* invoice: it was paid, then 10 notebooks came back. Show
   the **return** and the **refund due**.
4. Show a **void** (payments are never deleted; they are reversed with a reason).

> "Balances change only through a compare-and-swap: a conditional update that names
> the figure that was read. If two cashiers pay the same bill at the same moment,
> exactly one wins. That is covered by a test that fires five payments in parallel."

### Step 4 - buying (1 min)

Open **Purchase Orders**: one partly received, one awaiting delivery. Show the
supplier's statement (what we owe is what has been *delivered*, not ordered).

> "Stock goes up only on a goods receipt, never on an order. Cost is a moving
> average, frozen onto each sale, so margin is always the margin of that sale."

### Step 5 - who can see what (1 min)

In the **second window** signed in as the sales staff:

- The Patna-only user sees only Patna's stock.
- No **Reports**, no **Staff**, and **cost prices and margins are absent** (not
  hidden by CSS - the server never sends the fields).

Back in the owner window: **Administration -> Roles** shows permissions are editable per
business.

> "Permissions are checked on the server on every request. The buttons being hidden
> in the browser is cosmetic; the API refuses regardless."

### Step 6 - insight (1 min)

- **Dashboard**: sales trend, best sellers, "running low", "waiting on you".
- The **bell**: low-stock and overdue alerts, each raised once.
- **Reports -> Sales**, group by customer, then **Download CSV**.

### Close (30 seconds): the engineering

Show the terminal with `npm test` passing (186 tests), then the CI file and
`docs/security.md`.

> "186 automated tests, including parallel-payment races and cross-business
> isolation tests. A security review that found and fixed real bugs. CI and Docker
> are set up, and everything is documented."

---

## 3. The architecture in one minute

```
 Browser (React + TanStack Query)
        |   JSON over HTTPS, access token in a header,
        |   refresh token in an httpOnly cookie
        v
 Express API  ->  middleware: helmet, CORS, rate limit, auth, permission, validation
        |
        v
 Services (business rules)  ->  Mongoose models  ->  MongoDB (replica set)
        ^
        |
 packages/shared  <-  the same pure money/pricing/ageing code used by BOTH sides
```

Say these four things and you have covered the design:

1. **Multi-tenant.** Every record has an `organizationId` taken from the login
   session, never from the request. A database plugin throws if any query forgets it.
   A record from another business returns 404, so its existence isn't even revealed.
2. **Money is whole paise.** No floating point rupees anywhere.
3. **The ledger is the truth.** Stock is an append-only list of movements; the
   balance is a cached total that can always be reconstructed.
4. **The server enforces everything.** The browser only shows what the server allows.

---

## 4. Questions you should expect

### "What can't AI do?" / "How much of this did the AI do?"

Be honest and specific; reviewers can tell. **Say plainly that you built it with an
AI coding assistant (Claude Code)** and then show what you contributed and what you
understand. You should be able to open any file and explain it. Claiming you typed
every line yourself would be false, and it is the one thing that can sink the review.

What AI could not do in this project, with real examples:

| AI cannot... | Example from this project |
|---|---|
| **Decide what to build or why** | You chose the problem (Indian shops), the scope (no GST in v1), the workflow (quotation -> order -> invoice is optional), and the classic ledger-book look |
| **Know your users** | Credit days, discount limits, "refund due" and the Hindi labels come from how shopkeepers work. They need checking with a real shopkeeper; nobody was interviewed |
| **Check itself without running things** | Bugs were found only by running the code: a 500 error when two reads shared one transaction; a bill showing 0 days late the morning after its due date; a customer statement that disagreed with the summary; an oversize request returning 500 instead of 413; date filters that used UTC instead of Indian time. Tests caught these - reading the code did not |
| **Be certain it's right** | It can be confidently wrong. Everything important has a test, because trust comes from evidence |
| **Create accounts or run your infrastructure** | It could not create the MongoDB Atlas cluster, and the Docker setup has never been run on this machine |
| **Judge real-world usability** | Whether staff find the screens quick at a busy counter can only be learned by watching people use it |
| **Take responsibility** | GST compliance, data-protection law and the consequences of a billing error remain a human's accountability |
| **Remember context forever** | Long sessions lose detail; decisions are written in `docs/` for that reason |

A good one-sentence answer:

> "AI is very fast at producing code, but it doesn't decide what's worth building,
> it can't know the real users' needs, and it can be confidently wrong - so the
> value I added was deciding the requirements, making it prove itself with tests,
> and being able to explain and defend every part."

### Technical questions, with short answers

**Why integers for money?** Floating point can't represent 0.1 exactly, so sums
drift. 4.80 rupees is stored as 480 paise; arithmetic is exact.

**What stops two people paying the same invoice twice?** A conditional update:
"set paid = new value *where paid still equals the value I read*". If someone got in
first it matches nothing and the second payment is refused. A test fires five at once.

**What stops one shop seeing another's data?** The tenant id comes from the session;
a Mongoose plugin refuses any query without it; cross-tenant ids return 404; and a
test suite tries to break exactly this.

**Why MongoDB? Why a replica set?** Flexible documents suit invoices with embedded
lines and rate cards. Transactions (needed so an invoice, its stock movement and its
payment succeed or fail together) require a replica set.

**How are passwords and sessions handled?** bcrypt (cost 12). Short-lived access
token (15 min) plus a rotating refresh token in an httpOnly cookie, stored only as a
hash; reusing an old refresh token revokes the whole session.

**What if the shop sells more than it has?** Refused by default (single atomic
decrement, so the last unit can't be sold twice); the owner can allow it deliberately.

**How do you know it works?** 186 automated tests, a 56-check end-to-end smoke test,
and CI that runs them against a real MongoDB on every push.

**What would you do next?** GST-compliant invoices, an edit screen for draft
quotations, email for invitations and password reset, shared-store rate limiting,
and tested backups.

### Limitations to admit before they are found

- No GST-compliant invoice format (HSN, CGST/SGST/IGST) - deliberately out of scope for v1.
- No email: staff accounts are created with a password handed over directly.
- Draft quotations can be edited through the API but there is no screen for it.
- Docker and the CI workflow were written without being run locally.
- Rate limiting is per process; fine for one server, not several.
- It runs on a local database unless you connect your own Atlas cluster.

Admitting these yourself reads as maturity; having them discovered reads as a gap.

---

## 5. Other functionality worth knowing

| Area | What to mention |
|---|---|
| Branches | Stock is per branch; staff can be limited to branches; two-step transfers (goods on the truck belong to neither branch) |
| Inventory | Corrections need a reason; low-stock and out-of-stock alerts; full stock history |
| Pricing | Retail, wholesale, dealer lists; quantity slabs; per-customer default list |
| Credit | Credit days set the due date; optional credit-limit enforcement |
| Quotations | Expire at end of day; extend; convert once to an order or invoice |
| Sales orders | Can be invoiced in parts |
| Returns | Proportional credit that always adds to the whole; refund bounded by what was paid |
| Reports | Sales, tax, collections, who owes us, whom we owe, purchases, stock value, reorder list; all export to CSV, protected against spreadsheet formula injection |
| Notifications | Per-user read state, no duplicate alerts, hourly overdue sweep |
| Settings | Discount threshold, credit-limit enforcement, invoice footer and payment instructions |
| Audit log | Who changed what and the previous value; append-only |
| Print | Invoices, statements and reports print cleanly |
| Optional | Google sign-in; Cloudinary product images |

---

## 6. If something goes wrong during the demo

| Problem | Fix |
|---|---|
| Page won't load | Is `npm run dev` running? Open <http://localhost:5173> |
| "Can't reach database" / API errors on start | Is Terminal 1 (`npm run db:local`) still running? |
| Login fails | Re-run `npm run seed`, then `npm run demo-data` |
| Numbers look wrong or an action is refused | The data has drifted; re-seed |
| A rule refuses something you expected to work | That is often the point - explain the rule |
