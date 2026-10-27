# 01 — Commercial decisions (planning revision)

**Status: PLANNING ONLY — nothing here is approved for publication or
implementation.** Revision date: 2026-10-27.

This revision records a set of *proposed* commercial decisions supplied for
planning, calculates the annual-plan economics, separates two different
grace-period concepts, lists the rules that remain unresolved, and reviews
the existing SQL/API build against the proposal.

**Hard constraints still in force (unchanged):**

- Prices stay **unpublished**: `PRICING_APPROVED = false`,
  `PUBLISH_PRICES` unset → `GET /api/plans` answers 403.
- Checkout stays **disabled**: `COMMERCE.*` flags false,
  `CHECKOUT_ENABLED` unset → `POST /api/checkout` answers 503.
- **No plan/price rows** exist in the database; none are seeded here.
- The proposed prices below appear **only in this internal document** —
  not in site content, SQL, API code, or any customer-facing surface.
- No code, SQL, or configuration is changed by this revision.

## How to read the statuses

| Status | Meaning |
| --- | --- |
| **Proposed** | Owner-provided in this revision; used as the planning baseline. NOT approved for publication, schema seeding, or code. |
| **Confirmed** | Already fixed in the build (cannot drift). |
| **Unresolved** | Still open; must be answered before the related code/SQL exists or any gate flips. |

---

## 1. Proposed commercial decisions (planning baseline)

| # | Decision | Proposed value | Status |
| --- | --- | --- | --- |
| P1 | Commercial model | **Recurring subscription** (replaces the earlier one-time-licence draft) | Proposed — planning only |
| P2 | Monthly price | **GHS 599** per month | Proposed — **unpublished**, economics flagged (§2) |
| P3 | Annual price | **GHS 1,999** per year | Proposed — **unpublished**, economics flagged (§2) |
| P4 | Free trial | **14 days** | Proposed — rules unresolved (§4.3) |
| P5 | Payment methods | **Mobile Money and card**, subject to provider support and eligibility | Proposed — renewal mechanics unresolved (§4.1, §4.2) |
| P6 | Licence scope | **One subscription per shop**, covering authorized devices under a policy **still to be defined** | Proposed — scope rules unresolved (§4.4) |
| P7 | Offline licence grace | **7 days**, proposed and **not implemented** | Proposed — see §3; POS-side, separate approval |

### Consequences flagged now (not actions taken)

1. **The marketing site currently says something different.** Live draft
   content advertises *three one-time tiers* — Starter GHS 499 / Business
   GHS 899 / Professional GHS 1,499 — "one-time licence **for one computer**"
   with six months of support (`src/config/pricing.ts`, FAQ, Comparison).
   The proposal is *one subscription **per shop**, monthly/annual*. If the
   proposal is approved, the site copy needs its own approved revision.
   **No site content is changed by this document.** The existing draft
   prices remain flagged `PRICING_APPROVED = false`.
2. **Packaging is undefined.** The proposal prices one product at two
   intervals; it does not say what happens to the three-tier structure
   (do tiers survive? is599 the Starter price?). Unresolved — §4.

---

## 2. Annual-plan economics — FLAG FOR EXPLICIT REVIEW

Do **not** change the price based on this section; it is computed and
flagged so the owner can confirm the number is intentional.

### The calculation

| Item | Value |
| --- | --- |
| 12 monthly payments | 12 × GHS 599 = **GHS 7,188** |
| Proposed annual price | **GHS 1,999** |
| Discount vs paying monthly | (7,188 − 1,999) ÷ 7,188 = 5,189 ÷ 7,188 ≈ **72.2%** |
| Effective monthly rate on annual | 1,999 ÷ 12 ≈ **GHS 166.58/month** |
| Annual price expressed in monthly payments | 1,999 ÷ 599 ≈ **3.34 months** |
| Customer saving per year | **GHS 5,189** |

### Why this is flagged

- A **≈72.2% discount** is far outside the usual 10–20% range for annual
  prepayment incentives. Reference points for review:
  - 10% discount → GHS 6,469/year
  - 20% discount → GHS 5,750/year
  - 30% discount → GHS 5,032/year
- At GHS 1,999, an annual subscriber pays the equivalent of ~3.34 monthly
  instalments for 12 months of service (≈8.66 months effectively free),
  before any trial time.
- Combined with a 14-day free trial, the acquisition cost per annual
  customer is high unless renewal rates are very strong.

### Questions for explicit owner confirmation

1. Is GHS 1,999 intentional, or was a different figure (e.g. 5,990 =
   "pay 10 months, get 12" ≈ 16.7% off) intended?
2. Is GHS 599/month the intended anchor for a *single* product, or does it
   belong to one tier of the three-tier structure (§1 consequence 2)?
3. Should the annual discount be capped/defined as a policy (so future
   price reviews follow a rule rather than a number)?

**Until answered, P2/P3 stay proposed and unpublished.**

---

## 3. Two different grace periods — keep them separate

These are different mechanisms on different systems. They must never be
conflated, and neither is implemented.

| | **Offline licence grace** | **Subscription-expiry grace** |
| --- | --- | --- |
| Question it answers | "How long does the installed POS keep working without phoning home?" | "How long do server-side entitlements (downloads) keep working after `valid_to`?" |
| Where it would live | Inside the **POS application** (client-side) | **Commerce API** (`evaluateDownloadAccess`, `entitlements.valid_to`) |
| Proposed value | **7 days** (P7) | **Nothing proposed — unresolved** (§4.8) |
| Current build | **Nothing** — the POS has *no licence enforcement at all* today (doc 04) | **None** — strict `now >= valid_to` ⇒ deny; access stops exactly at expiry |
| Approval path | Separate, approval-gated POS integration (doc 04) | Commerce decision + small code change |

**Rule:** the 7-day offline grace does **not** extend
`entitlements.valid_to`, does **not** grant download access, does **not**
represent paid time, and must never be recorded as an entitlement period.
Conversely, any subscription-expiry grace approved later applies only to
server-side access and says nothing about the installed POS.

---

## 4. Unresolved rules (must be decided before implementation)

### 4.1 Automatic card renewal and customer consent
- **Proposed direction:** card auto-renewal allowed, subject to Paystack
  support and eligibility (P5).
- **Open:** opt-in vs opt-in-by-default; exact consent wording and where
  consent is recorded; pre-renewal notice timing; how a customer stops it
  (cancel → end of period?); card-expiry/expired-card behaviour (Paystack:
  *subscriptions aren't retried*); whether annual plans auto-renew too.
- **Build today:** checkout sends **no** Paystack `plan` parameter → every
  charge is one-time; `subscriptions.auto_renew` exists (default `false`)
  but nothing sets it; **no consent capture exists**.

### 4.2 Mobile Money renewal
- **Proposed direction:** MoMo accepted as a payment method (P5).
- **Provider constraint (official docs):** MoMo is one-time only and
  non-reusable → **cannot be auto-debited**; renewals must be manual.
- **Open:** renewal flow (re-issue checkout link? new checkout from
  account?); reminder schedule and channels before expiry; whether renewal
  periods stack (they do today) or overlap; strict stop vs grace at expiry
  for MoMo customers (§4.8); handling abandoned renewals.
- **Build today:** a new successful charge extends the entitlement window
  (stacking) ✓; **no reminders, invoices, or email** exist.

### 4.3 Trial eligibility, notifications, and paid conversion
- **Proposed:** 14-day free trial (P4).
- **Open:** eligibility (new customers only? one trial per shop/email?);
  trial start trigger (sign-up vs first checkout); whether a payment method
  is required to start; notification schedule during trial; what happens at
  trial end without payment (stop, grace, or manual follow-up); conversion
  charging mechanics — **Paystack's trial/collection support must be
  verified against its official docs during integration (not verified
  here)**; abuse prevention.
- **Build today:** **no trial support anywhere** — `plans` has no trial
  column, `entitlements` only knows `valid_from/valid_to`, and checkout
  charges immediately. A future-dated `valid_from` means "not yet
  active", not "free trial".

### 4.4 Branch and device limits
- **Proposed:** one subscription per shop; authorized devices under a
  policy still to be defined (P6).
- **Open:** what a "shop" is (single location? brand with branches?);
  whether branches share one subscription or need their own; device count
  per plan; activation/deactivation flow; behaviour at the limit;
  shared/till devices; which user(s) manage a shop (multiple users per
  shop?).
- **Build today:** **no shop/store entity exists**; `profiles` are
  per-user; `subscriptions` has **no uniqueness constraint** (a user could
  hold several); **no device/activation table or API exists**; the POS has
  no licence enforcement to attach devices to (doc 04).

### 4.5 Cancellation and access through the paid period
- **Open:** immediate vs end-of-period cancellation; self-serve vs
  support-mediated; whether downloads and the installed POS are affected;
  reactivation rules; explicit confirmation that access runs through the
  paid period.
- **Build today:** `subscription.disable` events **never shorten access**
  (customer keeps access to `valid_to`) — matches "access through the
  paid period" *if* that rule is chosen; `POST /api/subscription {cancel}`
  is an explicit **501** with `reason: cancellation_policy_pending_approval`
  and stays that way until this section is answered; entitlement revocation
  exists only as a manual status (`revoked`).

### 4.6 Refunds, disputes, chargebacks, and failed payments
- **Open:** refund window and partial refunds; whether a refund revokes
  access immediately or at period end; chargeback/dispute handling;
  failed-payment retries or dunning (Paystack does not retry subscription
  charges); grace after a failed payment; who reviews `needs_attention`
  rows.
- **Build today:** refund/dispute webhook events are **recorded but
  deliberately not applied**; `orders.status='refunded'` and
  `entitlements.status='revoked'` exist for manual use only;
  `invoice.payment_failed` marks the subscription `attention` and access
  runs on to `valid_to` (no shortening).

### 4.7 Taxes, payment fees, support coverage, and renewal notifications
- **Open:** are GHS 599 / 1,999 tax-inclusive (VAT/levies)?; who bears
  Paystack/MoMo fees — net revenue math matters especially with the
  flagged 72.2% annual discount; is support included for as long as the
  subscription is active (vs the site's "first six months" promise);
  renewal-notice timing and channels (email needs the reserved-but-
  unbuilt sending integration; SMS/WhatsApp?).
- **Build today:** no tax or fee fields in the schema (`orders.amount_minor`
  = the charged amount only); no email/notification code exists; the site
  still promises a one-time licence with six months of support.

### 4.8 Expiry, grace periods, revocation, and offline operation
- **Open:** whether a **subscription-expiry grace** exists at all (days,
  and whether it covers downloads only or full access); revocation
  triggers (refund, abuse, non-payment) and who executes them; offline
  operation rules beyond the proposed 7-day licence grace (what happens
  when it lapses — read-only? blocked? data preserved?) and how often the
  POS must check in; interaction between revocation and offline state.
- **Build today:** strict expiry (§3), no expiry grace, no automated
  revocation, no POS-side check-in of any kind.

---

## 5. Decision register (numbered for cross-references in other docs)

Docs/02 refers to these numbers. Statuses updated by this revision.

| # | Decision | Status now |
| --- | --- | --- |
| 1 | Approved prices | **Proposed** (599 / 1,999) — unpublished; **economics flagged (§2)** |
| 2 | What a payment buys (one-time vs access periods) | **Proposed direction:** recurring subscription (P1); site-copy conflict flagged (§1); packaging open (§4) |
| 3 | Billing interval per plan | **Proposed:** 1 month / 12 months (fits `plans.interval_months` 1–60) |
| 4 | Card auto-renewal | **Unresolved** — rules in §4.1 (no plan codes sent today) |
| 5 | Mobile-money renewal | **Unresolved** — rules in §4.2 (manual renewal only) |
| 6 | Cancellation policy | **Unresolved** — §4.5 (501 skeleton stays) |
| 7 | Expiry & grace | **Split:** offline licence grace 7 days proposed (§3); subscription-expiry grace **unresolved** (§4.8) |
| 8 | Refund & dispute handling | **Unresolved** — §4.6 (events recorded, not applied) |
| 9 | Support period vs access period | **Unresolved** — §4.7 |
| 10 | Currency | **Confirmed: GHS only** (schema-enforced `currency = 'GHS'`) |
| 11 | When draft prices may be published | **Unresolved** — both server flags stay off |

---

## 6. Gating controls (unchanged, all currently OFF)

| Control | Where it lives | Current value | What it gates |
| --- | --- | --- | --- |
| `PRICING_APPROVED` | `src/config/pricing.ts` | `false` | Showing draft prices as approved |
| `COMMERCE.accountEnabled / paymentsEnabled / downloadEnabled` | `src/config/commerce.ts` | all `false` | Customer-area status rows |
| `PUBLISH_PRICES=true` | Vercel env (server) | unset (off) | `GET /api/plans` — else **403 `pricing_not_approved`** |
| `CHECKOUT_ENABLED=true` | Vercel env (server) | unset (off) | `POST /api/checkout` — else **503 `checkout_disabled`** |
| `ALLOW_LIVE_PAYMENTS=true` | Vercel env (server) | unset (off) | Accepting any Paystack key not `sk_test_*` |
| Plan rows in `plans` | SQL | **no rows seeded** | Anything purchasable at all |

Checkout additionally rejects client-supplied price fields
(`client_price_not_allowed`), so an unapproved price cannot reach a
customer-facing checkout even if a flag were flipped by mistake.

---

## 7. Gap review: proposed rules vs current SQL/API (report only — nothing changed)

### Fits as-is (no change needed for the proposal)

- `currency = 'GHS'` CHECK (P2/P3 currency) — confirmed.
- `plans.interval_months` accepts 1 and 12 (P2/P3 intervals).
- Renewal stacking via `charge.success` extension; idempotent
  double-entry protection; server-side prices; deny-by-default RLS;
  `subscriptions.channel` enum already includes `mobile_money`.
- Strict `valid_to` enforcement and the 501 cancellation skeleton remain
  correct *while* §4.5/§4.8 are open.

### Mismatches / gaps (must be resolved later — no SQL executed, no code changed)

| # | Proposed rule | Current build | Gap |
| --- | --- | --- | --- |
| G1 | Recurring subscription (P1) | Checkout performs a **one-time** Paystack charge (no `plan` param); `plans.paystack_plan_code` exists but unused | Checkout must create a provider subscription with a plan code (after approval + Paystack plan setup). Webhook already handles renewal `charge.success` ✓ |
| G2 | 14-day free trial (P4) | **No trial support anywhere** (schema, API, checkout) | Needs schema (trial fields/status), a trial-start flow, conversion charging, and **verified** Paystack trial mechanics (§4.3) |
| G3 | Prices 599/1,999 (P2/P3) | No plan rows (correct); site still shows 499/899/1,499 three-tier drafts | Seed rows only after §2 review + approval; site copy needs a separate approved revision (§1) |
| G4 | One subscription per shop (P6) | **No shop entity**; no uniqueness on `subscriptions`; profiles are per-user | Shop model + uniqueness constraint + user↔shop mapping (§4.4) |
| G5 | Authorized-device policy (P6) | **No device/activation table or API**; POS has no licence enforcement | New design + separate approval (doc 04) (§4.4) |
| G6 | Card auto-renew + consent (P4.1) | No plan codes, `auto_renew` never set, **no consent record** | Consent capture + audit + plan wiring (§4.1) |
| G7 | MoMo renewals (P4.2) | Renew-by-new-charge works ✓; no reminders/invoices/emails | Notification flow + renewal policy (§4.2) |
| G8 | Cancellation w/ paid-period access | Reducer never shortens access ✓; cancel = 501 ✓ | Keep 501 until §4.5 answered |
| G9 | Refunds/disputes/chargebacks | Events recorded, **not applied**; manual statuses only | Policy first (§4.6), then reducer work |
| G10 | Failed payments | `attention` + access to `valid_to`; no retries/dunning | Dunning/grace policy (§4.6, §4.8) |
| G11 | Subscription-expiry grace | Strict expiry, no grace | If approved: change `evaluateDownloadAccess` + docs (§4.8) |
| G12 | Offline licence grace 7 days (P7) | **No POS licence enforcement exists at all** | Separate approval-gated POS integration; never modeled as entitlement time (§3, doc 04) |
| G13 | Taxes/fees (§4.7) | No tax/fee fields | Decide treatment; possible schema addition later |
| G14 | Renewal notifications (§4.7) | No sending integration (key reserved only) | Build after policy |
| G15 | Channel selection (P5) | Checkout sends no `channels` → Paystack account defaults | Configure/verify during integration |

---

## 8. What approval means (updated path)

1. Owner answers §2 (economics) and every §4 rule; §5 statuses move to
   resolved.
2. Owner approves a **site-copy revision** (three one-time tiers →
   subscription packaging) as a separate change.
3. Schema/API work for trials, shop, devices, consent and plan-based
   checkout is written and reviewed as its own revision.
4. Plan rows (1-month / 12-month, approved amounts) are seeded; test-mode
   end-to-end run passes (checkout → webhook/verify → entitlement →
   download → hash check).
5. `PUBLISH_PRICES=true` and `CHECKOUT_ENABLED=true` are set **together**
   in production; live payments remain a separate explicit switch
   (`ALLOW_LIVE_PAYMENTS`).

Until step 5, no customer can be charged anything — by design.
