# 03 — Environment variables (names only, no values)

**No secrets are stored in this repository.** This file lists the variable
*names* the commerce API expects, where they live, and what each one does.
Values are entered only in the Vercel project settings (server-side) and —
for the publishable key only — in the Vercel **frontend** env vars once the
account UI is enabled (see the client section below).

Rules enforced in code (`api/_lib/env.ts`):

- Only the server process environment is read. `VITE_*` variables are
  **never** read by API code (Vite inlines those into the public bundle).
- Missing or invalid configuration ⇒ every endpoint returns
  **503 `commerce_not_configured`**, echoing only missing/invalid *names*.
- `PAYSTACK_SECRET_KEY` must start with `sk_test_` unless
  `ALLOW_LIVE_PAYMENTS=true` — a live key cannot be used by accident.
- Pasting a publishable key (`pk_…`, `sb_publishable_…`) into a secret slot
  is detected and rejected.

## Server-side (Vercel project → Environment Variables)

| Name | Required | Used by | Purpose / validation |
| --- | --- | --- | --- |
| `SUPABASE_COMMERCE_URL` | yes | all DB endpoints | Base URL of the **dedicated commerce** Supabase project. Must be `https://` (localhost allowed for dev). No trailing slash needed. |
| `SUPABASE_COMMERCE_SERVICE_ROLE_KEY` | yes | all DB endpoints | Service-role key (bypasses RLS). Server-only; must be `sb_secret_…` or a JWT; a `sb_publishable_…` value is rejected. |
| `SUPABASE_AUTH_JWT_SECRET` | yes | `requireSession` | HS256 secret for verifying commerce-project access tokens (min 16 chars). |
| `PAYSTACK_SECRET_KEY` | yes | checkout, verify | Paystack **secret** key; must be `sk_test_…` unless `ALLOW_LIVE_PAYMENTS=true`. Must start with `sk_` (rejects `pk_…`). |
| `PAYSTACK_WEBHOOK_SECRET` | no | webhook signature | HMAC secret for `x-paystack-signature`. Defaults to `PAYSTACK_SECRET_KEY` (Paystack signs with the integration secret). |
| `PAYSTACK_PUBLIC_KEY` | no | (future client) | Publishable key; unused by current API code. Never put a secret here. |
| `APP_BASE_URL` | yes | checkout callback | Public site origin, e.g. `https://your-domain.example`. Used for Paystack `callback_url`; the domain must be allowed in the Paystack dashboard. |
| `INSTALLER_BUCKET` | no (default `installers`) | download | Private bucket name; validated `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`. |
| `DOWNLOAD_LINK_TTL_SECONDS` | no (default `300`) | download | Signed-URL lifetime; integer 60–3600. |
| `CHECKOUT_ENABLED` | **approval gate** | checkout | Literal `true` enables `POST /api/checkout`. Unset = disabled. Only after doc 01 is approved. |
| `PUBLISH_PRICES` | **approval gate** | plans | Literal `true` allows `GET /api/plans` to return prices (else 403). Only after doc 01 is approved. |
| `ALLOW_LIVE_PAYMENTS` | no (default off) | config validation | Must be explicitly `true` before a `sk_live_…` key is accepted. Keep unset until a deliberate live launch. |
| `AUDIT_HASH_SALT` | no | download, audit | Salt for `SHA-256(salt:ip)` in audit rows. If unset, `ip_hash` is stored as `null` (no IP recorded at all). |
| `DOWNLOAD_ACCESS_MODE` | no (default `entitlement`) | download, status | Who may request a download session. `entitlement` (default, unchanged): authenticated **subscription** required. `verified_account`: any **email-verified** account (owner decision, see doc 01 §6). Any other value fails config validation with 503. |
| `RESEND_API_KEY` | no (future) | not implemented | Reserved for renewal/OTP emails when email sending is approved and built. |
| `EMAIL_FROM` | no (future) | not implemented | Sender address for the above. |

## Client-side (Vercel → Environment Variables, inlined into the JS bundle)

These are the **only** variables the browser bundle may contain. Both are
publishable, never secret. While `accountEnabled`/`downloadEnabled` are `false`
in `src/config/commerce.ts` these are not needed at all — leave them unset.

| Name | Required | Used by | Purpose / validation |
| --- | --- | --- | --- |
| `VITE_COMMERCE_SUPABASE_URL` | yes, once accounts are enabled | `src/lib/supabaseAdapter.ts` | Base URL of the **dedicated commerce** Supabase project (never the POS project). Must be `https://` (localhost allowed for dev). |
| `VITE_COMMERCE_SUPABASE_ANON_KEY` | yes, once accounts are enabled | `src/lib/supabaseAdapter.ts` | The commerce project's **anon / publishable** key (`sb_publishable_…` or JWT). The service-role key must never be given to the client. |
| `VITE_COMMERCE_API_BASE` | no (default `''`) | `src/lib/commerceClient.ts` | Origin of the serverless API when the site and the API are **not** on the same host. `''` (or unset) = same origin, which is the normal Vercel setup where `/api/*` is served beside the site. Set it only if the API is deployed elsewhere, e.g. `https://api.example.com` — no trailing slash, no path. |

Missing client config is handled gracefully: account pages show a
"not available" notice instead of crashing, and the API keeps working.

## Preview vs production

| | Preview (`vercel dev` / preview deployments) | Production |
| --- | --- | --- |
| Paystack key | `sk_test_…` (only option while `ALLOW_LIVE_PAYMENTS` is unset) | test key until a deliberate live switch |
| `CHECKOUT_ENABLED` / `PUBLISH_PRICES` | leave **unset** | set only after doc 01 approval |
| `DOWNLOAD_ACCESS_MODE` | unset (defaults to `entitlement`) | `verified_account` only if SamTill enables account-gated downloads (doc 01 §6) |
| Supabase project | a **scratch** commerce project (never the POS project) | the dedicated `samtill-commerce` project |
| `VITE_COMMERCE_*` | scratch project's URL + anon key | `samtill-commerce` URL + anon key, set only when accounts go live |
| Webhook URL | not registered | `https://<your-domain>/api/webhooks/paystack` (Paystack dashboard) |

## What must never happen

- Copying any variable from the POS application's `.env` into this project.
- Prefixing a secret with `VITE_` (it would be embedded in the JS bundle).
- Committing a `.env` file — `.gitignore` excludes env files; there are none.
- Printing values in logs or API responses (the API only ever echoes
  variable *names* of missing/invalid config, via `/api/status`).
