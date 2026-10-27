# 01 — Commercial decisions still required (block checkout launch)

**Status: UNRESOLVED.** This document records every commercial decision that
is still open. Online checkout must not be enabled — and draft prices must
not be presented as final — until the owner of SamTeck Digital approves each
item below in writing (email or signed note is fine).

Nothing in this repository approves anything: the site carries a preview
banner, the commerce API refuses checkout, and no plan/price rows exist in
the database schema.

## Why this gates the code

The commerce build is deliberately fail-closed. Every control below is
currently in its *off* state, so even a fully provisioned deployment cannot
charge a customer until the owner flips these:

| Control | Where it lives | Current value | What it gates |
| --- | --- | --- | --- |
| `PRICING_APPROVED` | `src/config/pricing.ts` | `false` | Publishing draft prices as approved on the site |
| `COMMERCE.accountEnabled / paymentsEnabled / downloadEnabled` | `src/config/commerce.ts` | all `false` | Status rows in the customer-area preview |
| `PUBLISH_PRICES=true` (server) | Vercel environment | unset (off) | `GET /api/plans` — otherwise **403 `pricing_not_approved`** |
| `CHECKOUT_ENABLED=true` (server) | Vercel environment | unset (off) | `POST /api/checkout` — otherwise **503 `checkout_disabled`** |
| `ALLOW_LIVE_PAYMENTS=true` (server) | Vercel environment | unset (off) | Accepting any Paystack key that is not `sk_test_*` |
| Plan rows in the `plans` table | SQL (never executed) | **no rows seeded** | The existence of anything purchasable at all |

Additionally, the checkout handler rejects any request that contains a
client-supplied price field (`client_price_not_allowed`), and prices are only
ever read from the server-side `plans` table — so an unapproved price cannot
reach a customer-facing checkout even if the flags were flipped by mistake.

## Decisions required

| # | Decision | Options / recommendation | Current state in code | Impact if wrong |
| --- | --- | --- | --- | --- |
| 1 | **Approved prices** for Starter / Business / Professional | Draft figures exist on the site (GH₵499 / 899 / 1,499, flagged `PRICING_APPROVED=false`). Confirm, amend or replace. | No `plans` rows exist; site shows a "draft awaiting approval" banner. | Charging the wrong amount; refunds and trust damage. |
| 2 | **What a payment actually buys** | Reconcile the site copy ("one-time licence, first six months of maintenance") with the commerce model (a paid **access period** of `interval_months` after which downloads lapse). Decide: one-time permanent licence with a support window, or renewable access periods? | Schema models renewable periods (`entitlements.valid_from/valid_to`, `plans.interval_months`). Site copy describes a one-time licence. **These do not yet agree.** | Customers and the entitlement system would disagree about when access ends. |
| 3 | **Billing interval per plan** | e.g. 6 months / 12 months / annual — and whether different packages differ. | `plans.interval_months` (1–60) exists; no values chosen. | Wrong entitlement lengths. |
| 4 | **Card auto-renewal** | Paystack can auto-debit **cards only** (official docs: subscriptions = card + Nigerian direct debit; Ghana mobile money cannot be auto-debited). Recommendation: offer opt-in card auto-renew later; keep prepaid by default. | Checkout intentionally sends **no** Paystack `plan` parameter → one-time charge only. `plans.paystack_plan_code` column exists but is unused (`null`). | Unexpected charges, or a renewal model that cannot work for MoMo customers. |
| 5 | **Mobile-money renewal process** | MoMo is one-time only. Decide: renewal reminders before expiry (email?), how long a customer has to renew, whether access stacks (current code stacks periods end-to-end with no gap). | Renewal = a new checkout; periods **stack** onto `valid_to`. No reminders implemented (email is optional/not wired). | Customers losing access abruptly; support load. |
| 6 | **Cancellation policy** | Immediate vs at-period-end; partial refunds? | `POST /api/subscription {action:"cancel"}` is an explicit **501 skeleton** with `reason: cancellation_policy_pending_approval`. `subscription.disable` events keep access until `valid_to`. | Illegal/unfair terms; chargebacks. |
| 7 | **Expiry & grace period** | Decide whether a failed renewal grants a grace window. | Access ends **exactly** at `valid_to` (no grace). A failed renewal marks the subscription `attention` but never shortens access. | Either stranded customers or unpaid access. |
| 8 | **Refund & dispute handling** | Refund window, and whether a refund revokes access. | Refund/dispute webhook events are **recorded but deliberately not applied** (`ignored`) pending this decision. `orders.status = 'refunded'` and `entitlements.status = 'revoked'` exist for manual use. | Refunded customers keeping downloads, or policy breaches. |
| 9 | **Support period vs access period** | Site promises "first six months of maintenance and support". Is that the same clock as the download entitlement? | Two independent concepts in the model; only the access clock is implemented. | Support obligations not honoured. |
| 10 | **Currency assumption** | Schema hard-checks `currency = 'GHS'`. | Enforced by CHECK constraints in `0001_commerce_init.sql`. | Schema migration needed if USD/other currency is wanted. |
| 11 | **When draft prices may be published** | The marketing site already shows draft prices under a preview banner; `GET /api/plans` stays 403 until `PUBLISH_PRICES=true`. Decide the moment both flip together with `CHECKOUT_ENABLED`. | Both server flags unset. | Prices shown as final before approval. |

## What approval means (for the next phase)

1. Owner answers each row above (a marked-up copy of this file is enough).
2. Plan rows are inserted into the commerce database with approved amounts,
   `active = true`, and (only for card auto-renew) Paystack plan codes.
3. `PUBLISH_PRICES=true` and `CHECKOUT_ENABLED=true` are set **together** in
   the production Vercel project, after a test-mode end-to-end run.
4. This file is updated to mark decisions resolved.

Until step 3 happens, no customer can be charged anything, by design.
