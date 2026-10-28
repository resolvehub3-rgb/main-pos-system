# 02 — Commerce architecture (preparation build)

How the prepared-but-disabled SamTill commerce system fits together:
components, data flows, schema, security, what was tested locally, and what
remains before it can be trusted with real money.

Read alongside:
- `01-commercial-decisions.md` — what must be approved first.
- `03-environment-variables.md` — what must be provisioned.
- `../api/README.md` — endpoint matrix and webhook response policy.
- `../db/README.md` — the never-executed SQL.

## 1. Components

| Component | Location | State |
| --- | --- | --- |
| Marketing site (React/Vite) | `src/` | **shipped** (approved earlier); includes an inert commerce preview (`src/components/CommercePreview.tsx`) |
| Commerce API | `api/*.ts`, `api/webhooks/paystack.ts` | **written + type-checked + unit-tested**; every handler fails closed without provisioned config |
| Commerce database schema | `db/migrations/0001_commerce_init.sql` | **prepared, never executed** |
| Commerce Supabase project ("samtill-commerce") | external | **does not exist yet** (separate from the POS project, by rule) |
| Paystack account (test mode) | external | **not integrated yet** — no webhook registered, no plan codes |
| Installer storage (private `installers` bucket) | external | **not created yet**; no file uploaded |
| CI / deploys / pushes | — | **none**; everything in this repo is uncommitted and local |

Isolation rules in force: the POS app, its Supabase project, its `.env`, its
Electron config and all deployments are untouched. Commerce never reads POS
credentials; the POS never reads commerce credentials.

## 2. Data flows

### Account creation (future)
User signs up in the Supabase **commerce** project → `auth.users` row →
`profiles` row (email required, display name optional). RLS: users read only
their own profile; writes are service-role only.

### Checkout (`POST /api/checkout`)
```
client ──{plan_id, email}──▶ api/checkout
        guard: CHECKOUT_ENABLED, rate limit (10/10 min/IP)
        resolve plan row server-side (client_price_not_allowed if price sent)
        create order (pending, GHS, server price) ──▶ Paystack transaction
        (amount re-asserted server-side; callback_url = APP_BASE_URL)
        ──▶ {authorization_url, reference}
```
Nothing is charged at this point; the customer is redirected to Paystack.

### Payment confirmation (two safe paths, race-tolerant)
```
A. redirect ──▶ client ──▶ POST /api/verify {reference}
      server calls Paystack /transaction/verify
      checks: success, amount, currency, metadata.reference = our order
B. Paystack ──▶ POST /api/webhooks/paystack
      x-paystack-signature = HMAC-SHA512(raw body, secret), constant-time
both paths ──▶ webhook_events.dedupe_key (unique) ──▶ order pending→paid
        ──▶ subscription create/extend (event reducer) ──▶ entitlement window
```
Whichever path arrives second is a no-op (dedupe row + conditional update).
`/api/verify` intentionally does **not** require `CHECKOUT_ENABLED` so that
an in-flight payment can always be confirmed.

### Installer download (`POST /api/download`)
```
authenticated user (Supabase access token in Authorization header)
  → DOWNLOAD_ACCESS_MODE gate:
      entitlement (default)      → active entitlement? (deny otherwise)
      verified_account (opt-in)  → email_confirmed_at present? (deny otherwise)
                                   — owner decision (doc 01 §6, doc 05); this is
                                   download access, NOT a licence
  → newest active installer_releases row (server chooses; client cannot pick)
  → storage signed URL, TTL ≤ DOWNLOAD_LINK_TTL_SECONDS (default 300 s)
  → download_events audit row MUST be written first (503 audit_unavailable
    if it fails — no unaudited downloads)
  → response includes version, size, sha256 for client-side verification
```

The customer-facing implementation of the register → verify → login → download
journey lives in the landing site (`src/pages/`, `src/lib/authFlow.ts`,
`src/lib/downloadClient.ts`) and is documented in **doc 05**. It is shipped
behind the `COMMERCE.accountEnabled` / `COMMERCE.downloadEnabled` flags (both
`false`).

## 3. Schema summary (`db/migrations/0001_commerce_init.sql`)

| Table | Purpose |
| --- | --- |
| `profiles` | 1:1 with `auth.users`; public email |
| `plans` | products/intervals; **no rows seeded** (pricing unapproved); GHS-only CHECK |
| `orders` | payment intent + status machine (`pending/paid/failed/refunded`) |
| `subscriptions` | provider subscription record + status incl. `attention` |
| `entitlements` | the download window: `valid_from/valid_to`, `active/expired/revoked` |
| `installer_releases` | version registry for the bucket; **one inactive seed row** v1.0.0 |
| `download_events` | per-grant audit trail (link expiry, IP hash, result) |
| `webhook_events` | idempotency: unique `dedupe_key`, claim states, payload purge marker |
| `audit_logs` | security-relevant actions; hash-chained |
| storage | bucket `installers` **private**; all `storage.objects` policies dropped; anon write privileges revoked — service-role only |

RLS is deny-by-default on every table; constraints and indexes included; the
seed row carries the verified installer reference (see doc 04). **None of
this has been run anywhere.**

## 4. Endpoint status matrix

See `../api/README.md` for the full table. Summary: `/api/status`,
`/api/plans`, `/api/checkout`, `/api/verify`, `/api/webhooks/paystack`,
`GET /api/subscription`, `/api/download` are **implemented** (fail-closed,
not yet exercised against live services); `POST /api/subscription` is a
deliberate **501 skeleton** (`reason: cancellation_policy_pending_approval`).

## 5. Security invariants (code-enforced)

1. **Fail closed** — missing/invalid config ⇒ 503, names only.
2. **Test-mode only** — `sk_test_` required unless `ALLOW_LIVE_PAYMENTS=true`.
3. **Server-side prices only** — client price fields rejected.
4. **No activation from redirects** — entitlements change only via `/api/verify`
   or a signature-verified webhook.
5. **Idempotency** — unique `dedupe_key` + conditional `pending→paid` update;
   webhook/verify races are safe.
6. **HMAC over exact raw bytes**, constant-time compare; RFC 4231 §4.3 vector
   verified in tests.
7. **Download fail-closed** — no URL without the audit row; server-chosen release.
8. **Rate limits** — checkout 10/10 min/IP, verify 20/10 min/user, download
   6/10 min/user (per-instance, best-effort).
9. **No secrets client-side** — no `VITE_*` secrets, no `.env`, API echoes
   only variable *names*.

## 6. Paystack constraints (official docs)

- Subscriptions (auto-charge) support **card and Nigerian direct debit only**;
  Ghana mobile money **cannot** be auto-debited → MoMo renewal must be manual
  (decision #5 in doc 01).
- MoMo (one-time, `mtn`/`atl`/`vod`, 180 s checkout window, `reusable:false`).
- "Subscriptions aren't retried" — dunning is not automatic → decision #7.
- Webhook: `x-paystack-signature` = HMAC-SHA512 over the **raw body**;
  optional IP allowlist `52.31.139.75 / 52.49.173.169 / 52.214.14.220`
  (not implemented — needs deployment-shaped config).
- Retries: live every 3 min ×4 then hourly ×72 h; test hourly ×10 h.
- Checkout currently sends **no `plan` param** → every charge is one-time;
  `plans.paystack_plan_code` exists but is unused pending decision #4.

## 7. Local test results (what actually ran)

| Check | Command | Result |
| --- | --- | --- |
| Type-check (src + api + tests) | `pnpm lint` | **exit 0** |
| Unit tests (no network/DB) | `pnpm test` | **68/68 pass** |
| Production build | `pnpm build` | **exit 0** (32 modules; `api/` never bundled) |
| Bundle secret scan | grep `dist/` for `sk_live_`, `sk_test_…`, `sb_secret_`, `service_role`, `PAYSTACK_SECRET`, `SUPABASE_COMMERCE`, `Authorization: Bearer`, `commerce_not_configured` | **all clean** |
| Installer reference | `Get-FileHash` on `release/SamTill-POS-Setup.exe` | size + SHA-256 match the SQL seed (doc 04) |

Suites: `signature.test.ts` (HMAC-SHA512 vs RFC 4231 §4.3, tamper/wrong
secret/malformed header), `session.test.ts` (HS256 JWT: expiry+skew, tamper,
`alg:none`, wrong secret/issuer/audience, `anon` role), `commerce-logic.test.ts`
(event reducer, entitlement decisions, plan/price rejection, rate limiter,
dedupe keys, month clamping).

## 8. Known limitations / assumptions

- **Not integration-tested**: real Paystack test-mode checkout, webhook
  delivery, Supabase REST, Storage signed URLs, Vercel runtime — all require
  the external services that do not exist yet (Phase 3+).
- **Session verification assumes** the future commerce project issues HS256
  access tokens (fallback documented: `/auth/v1/user` introspection).
- **Rate limits are per-instance in-memory** — best-effort on serverless; a
  shared store (e.g. Upstash) is a later hardening step.
- **Refund/dispute events are recorded but not applied** pending decision #8.
- **Webhook egress IP allowlisting not implemented** (needs known egress IPs).
- **No plan codes sent** → no auto-renewal yet (decision #4).
- **Email sending not implemented** (`RESEND_API_KEY` reserved only).

## 9. Integration checklist (future, each step approval-gated)

1. Owner approves doc 01 → plan rows inserted with approved prices.
2. Create dedicated Supabase project "samtill-commerce" (never the POS one).
3. Run `0001_commerce_init.sql` there (owner approval), verify RLS denials
   and bucket privacy using the commented verification queries.
4. Create private `installers` bucket; upload the installer (doc 04 procedure);
   verify SHA-256 after upload.
5. Create Paystack **test** integration; register webhook URL; keep test keys.
6. Set env vars (doc 03) in a Vercel **preview** deployment; run end-to-end:
   signup → checkout (test card) → verify + webhook → entitlement → download →
   hash check.
7. Failure drills: expired card, wrong amount, duplicate webhook, revoked
   entitlement, missing audit row.
8. Only then: production deploy, `PUBLISH_PRICES` + `CHECKOUT_ENABLED` flipped
   together, live-mode decision separate and explicit (`ALLOW_LIVE_PAYMENTS`).

## 10. Retention (documented in the migration, executed later by an approved job)

- `webhook_events`: purge payload after 90 days (row kept, `payload_purged_at`);
  delete row after 12 months.
- `download_events`: delete after 12 months.
- `audit_logs`: delete after 24 months.
- `orders` / `entitlements`: retain **7 years** for accounting — never purged
  by the jobs above.
- Backups: enable Supabase daily backups at launch; consider PITR once
  revenue depends on the data.
