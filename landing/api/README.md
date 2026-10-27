# SamTill commerce API (preparation build)

Vercel serverless functions for the future SamTill customer commerce system:
accounts → checkout → payment verification → entitlements → installer download.

**Nothing here is live.** There is no commerce backend provisioned yet, no
Paystack webhook registered, no approved prices. Every endpoint that needs
the backend **fails closed** (HTTP 503 `commerce_not_configured`) until the
environment variables in `../docs/03-environment-variables.md` are set, and
payment endpoints additionally require the `CHECKOUT_ENABLED=true` flag,
which must only be enabled after the decisions in
`../docs/01-commercial-decisions.md` are approved.

## Handlers

Vercel's web-handler signature is used throughout:

```ts
export function POST(request: Request): Response | Promise<Response>
```

Raw bodies are available exactly as received (`request.arrayBuffer()`),
which is what webhook HMAC verification requires. The secret key never
appears in a response; only variable *names* of missing config are echoed.

## Endpoint status matrix

| Endpoint | Method | Status | Notes |
| --- | --- | --- | --- |
| `/api/status` | GET | **implemented** (no backend) | Config/flag overview; names only, no values |
| `/api/plans` | GET | **implemented**, needs backend | 403 `pricing_not_approved` until `PUBLISH_PRICES=true` |
| `/api/checkout` | POST | **implemented**, needs backend + approval | 503 `checkout_disabled` until `CHECKOUT_ENABLED=true`; server-side price only |
| `/api/verify` | POST | **implemented**, needs backend + approval | Server calls Paystack; checks status/amount/currency/metadata against our order |
| `/api/webhooks/paystack` | POST | **implemented** (signature + idempotency unit-tested), needs backend | Fails closed; see response policy below |
| `/api/subscription` | GET | **implemented**, needs backend | Caller-scoped read |
| `/api/subscription` | POST | **skeleton — 501 `not_implemented`** | `cancel` blocked pending the cancellation-policy decision |
| `/api/download` | POST | **implemented**, needs backend | Entitlement check → 5-minute signed URL → fail-closed audit |

Legend:
- **implemented** = complete code path, type-checked, unit-tested where the
  logic is pure; *not yet* exercised against live Supabase/Paystack services
  (they do not exist yet), so an integration pass is still required.
- **skeleton** = deliberately returns 501 with a machine-readable reason.

## What is tested locally (`pnpm test`, no network, no database)

| Test file | Covers |
| --- | --- |
| `tests/signature.test.ts` | HMAC-SHA512 against the **RFC 4231 §4.3** vector; tamper/wrong-secret/missing/malformed header rejection; case/whitespace tolerance |
| `tests/session.test.ts` | Supabase JWT verification: valid, expired (+30 s skew), tampered payload, `alg:none` rejection, wrong secret, wrong issuer/audience, `anon` role rejection, missing `sub`/`exp`, `nbf` |
| `tests/commerce-logic.test.ts` | Event reducer (create/extend/duplicate/amount-mismatch/cancellation/grace), entitlement download decisions, plan resolution (client-price rejection), rate limiter, dedupe-key derivation, month clamping |

Not tested locally (requires provisioned services — part of the future
checklist): real Paystack test-mode checkout + webhook delivery, Supabase
REST reads/writes, Storage signed URLs, Vercel deployment behaviour.

## Security invariants

1. **Fail closed** — missing/invalid config ⇒ 503, never an insecure default.
2. **Test-mode only** — the config loader rejects any Paystack key that is
   not `sk_test_*` unless `ALLOW_LIVE_PAYMENTS=true`.
3. **No client-supplied prices** — checkout rejects any request body
   containing price-like fields (`client_price_not_allowed`).
4. **No activation from redirects** — a frontend redirect only triggers a
   server round-trip; entitlements change exclusively through
   `/api/verify` or a signature-verified webhook.
5. **Double-entry protection** — unique `webhook_events.dedupe_key` +
   `pending → paid` order transition; webhook and verify can race safely
   (the loser applies no patches).
6. **Constant-time signature comparison**; raw bytes are what get signed.
7. **Download fail-closed** — no signed URL is returned unless the grant
   audit row is written.
8. **Rate limits** — checkout (10 / 10 min per IP), verify (20 / 10 min per
   user), download (6 / 10 min per user). In-memory per instance: best-effort
   (documented limitation).
9. **No secrets in the client** — `VITE_*` variables are never read here;
   all keys are read from the server process environment.

## Webhook response policy (Paystack retries non-2xx)

| Situation | HTTP | `webhook_events.status` | Provider retries? |
| --- | --- | --- | --- |
| Invalid signature | 401 | not recorded | yes — expected only if misconfigured |
| Backend not configured | 503 | not recorded | yes — correct until provisioned |
| Duplicate delivery | 200 | unchanged | no |
| Applied / ignored event | 200 | `processed` | no |
| Logical mismatch (amount/unknown ref) | 200 | `failed` (manual review) | no — retries cannot fix it |
| Operational failure (network/DB) | 500 | `failed` | yes — retried, then reprocessed |

Paystack retry schedule (official docs): live — every 3 min ×4, then hourly
×72 h; test — hourly ×10 h. Egress IP allowlist (optional hardening, not
implemented): `52.31.139.75`, `52.49.173.169`, `52.214.14.220`.

## Local checks

```bash
cd landing
pnpm lint     # tsc --noEmit — type-checks src, api and tests
pnpm test     # node tests/run.ts — pure unit tests, no network
pnpm build    # vite build (frontend only; api/ is never bundled)
```
