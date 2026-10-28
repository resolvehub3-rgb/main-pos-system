# 00 — Environment & secrets matrix (all three deployables)

Every variable SamTill reads, where it belongs, and whether it is a secret.
**No values are stored in this repository.** The detailed validation rules for
the commerce API live in `landing/docs/03-environment-variables.md`.

There are **three separate deployables** plus per-till local software. Each has
its own environment — never copy a value between rows marked "keep apart".

---

## A. Commerce site — Vercel project (`landing/`, site + `/api/*`)

### Server-side (Vercel → Environment Variables — never in the bundle)

| Name | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `SUPABASE_COMMERCE_URL` | yes | no | Dedicated commerce Supabase project base URL |
| `SUPABASE_COMMERCE_SERVICE_ROLE_KEY` | yes | **yes** | Service-role key (bypasses RLS); server only |
| `SUPABASE_AUTH_JWT_SECRET` | yes | **yes** | HS256 secret used to verify commerce access tokens |
| `PAYSTACK_SECRET_KEY` | yes | **yes** | `sk_test_…` until `ALLOW_LIVE_PAYMENTS=true` |
| `PAYSTACK_WEBHOOK_SECRET` | recommended | **yes** | HMAC secret for `x-paystack-signature` (defaults to the secret key) |
| `PAYSTACK_PUBLIC_KEY` | no | no | Reserved; unused by current code |
| `APP_BASE_URL` | yes | no | Public site origin → Paystack `callback_url` |
| `INSTALLER_BUCKET` | no (default `installers`) | no | Private bucket holding installers |
| `DOWNLOAD_LINK_TTL_SECONDS` | no (default `300`) | no | Signed download-URL lifetime |
| `CHECKOUT_ENABLED` | launch gate | no | Literal `true` enables `POST /api/checkout` |
| `PUBLISH_PRICES` | launch gate | no | Literal `true` enables `GET /api/plans` |
| `ALLOW_LIVE_PAYMENTS` | live switch | no | Must be `true` before a `sk_live_…` key is accepted |
| `AUDIT_HASH_SALT` | recommended | **yes** | Salt for `SHA-256(salt:ip)` in download audit rows |
| `DOWNLOAD_ACCESS_MODE` | no (default `entitlement`) | no | `entitlement` (paying customers) or `verified_account` |
| `RESEND_API_KEY` | Phase 5 | **yes** | Reserved — transactional email not built yet |
| `EMAIL_FROM` | Phase 5 | no | Reserved — sender address |

### Client-side (Vercel → Environment Variables, inlined into JS)

| Name | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `VITE_COMMERCE_SUPABASE_URL` | yes, once accounts are on | no | Commerce project URL (never the POS project) |
| `VITE_COMMERCE_SUPABASE_ANON_KEY` | yes, once accounts are on | no | Publishable/anon key — safe by design, guarded by RLS |
| `VITE_COMMERCE_API_BASE` | no (default same origin) | no | API origin when the API is hosted separately |

---

## B. POS web app — static host (`/dist` build of the repo root)

| Name | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | no | **POS** Supabase project (keep apart from commerce) |
| `VITE_SUPABASE_ANON_KEY` | yes | no | POS anon key — currently powerful; see Phase 2 RLS lockdown |
| `VITE_SUPER_ADMIN_EMAIL` | bootstrap only | no | Super-admin bootstrap account |
| `VITE_SUPER_ADMIN_PASSWORD` | bootstrap only | **yes** | ⚠ **Compiled into the bundle.** Rotate, then remove before any production build (Phase 2) |
| `VITE_PRINT_BRIDGE_URL` | no (default `http://127.0.0.1:9210`) | no | Local receipt-print bridge on the till machine |

Variables that exist in `.env.example` but are read by **no running code**
today (no backend exists in this repository): `PORT`, `NODE_ENV`, `APP_URL`,
`PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `VITE_API_URL`.
`docs/DEPLOYMENT.md` and `render.yaml` still describe that non-existent
backend — being rewritten in Phase 4.

---

## C. Desktop installer build (`pnpm desktop:dist`)

Baked into the binary at **build time**, so build them from production values:

| Name | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | yes | no | Same values as the web build — the installer must point at production |
| `VITE_SUPER_ADMIN_*` | **do not bake** | — | Never included in a shipped installer |
| `SAMTILL_UPDATE_MANIFEST_URL` | no | no | Update-notification manifest URL (feed not published yet) |

Verify before shipping: `strings`/search the built `dist/` for your super-admin
password — if it appears, the build is wrong.

---

## D. Print bridge — each till machine only (`.env` next to the bridge)

`PRINT_BRIDGE_PORT`, `PRINT_BRIDGE_HOST`, `PRINT_BRIDGE_ORIGINS`,
`PRINT_BRIDGE_TOKEN`, `PRINT_TRANSPORT`, `PRINT_PRINTER`,
`PRINT_NETWORK_HOST`, `PRINT_NETWORK_PORT`, `PRINT_SPOOL_DIR` — all read by
`npm run print-bridge`, never by the browser. The bridge binds to `127.0.0.1`.

---

## E. Configuration outside the codebase (dashboards)

| Where | What must be set |
| --- | --- |
| Paystack dashboard | Business/domain verified; callback URL `https://<domain>/?checkout=return`; webhook `https://<domain>/api/webhooks/paystack` + secret hash; test keys while testing |
| Commerce Supabase | Site URL + redirect URLs for `<domain>`; Auth SMTP sender (Phase 1); private `installers` bucket; row-level security verified against the anon key |
| POS Supabase | Site URL; backups enabled (Phase 5) |
| DNS | `<domain>` A/CNAME → hosting; must resolve before Supabase redirects or Paystack callbacks work |

---

## Hard rules

1. **Never** copy a POS credential into the commerce project or vice versa —
   they are different Supabase projects by design (see `landing/docs/02`).
2. **Never** prefix a secret with `VITE_` — Vite inlines those into the public
   bundle, and the installer build bakes them into a shipped binary.
3. Never commit `.env` files (`.gitignore` covers them; the repo tracks only
   `.env.example` with placeholders).
4. Rotate anything that has ever been printed in a log, a screenshot or a chat.
