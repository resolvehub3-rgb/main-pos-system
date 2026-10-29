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
| `CHECKOUT_ENABLED` | launch gate | no | Literal `true` enables `POST /api/checkout` |
| `PUBLISH_PRICES` | launch gate | no | Literal `true` enables `GET /api/plans` |
| `ALLOW_LIVE_PAYMENTS` | live switch | no | Must be `true` before a `sk_live_…` key is accepted |
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
| `VITE_PRINT_BRIDGE_URL` | no (default `http://127.0.0.1:9210`) | no | Local receipt-print bridge on the till machine |

> There are intentionally **no** `VITE_SUPER_ADMIN_*` variables. `VITE_` values
> are compiled into the public bundle, so they can never hold a secret; the
> first super admin is provisioned server-side via the Supabase Admin API
> (see `docs/SECURITY.md`).

Variables that exist in `.env.example` but are read by **no running code**
today (no backend exists in this repository): `PORT`, `NODE_ENV`, `APP_URL`,
`PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `VITE_API_URL`.
`render.yaml` still describes a non-existent backend — it is legacy; the app
deploys to Vercel (see `docs/DEPLOYMENT.md`).

---

## C. Print bridge — each till machine only (`.env` next to the bridge)

`PRINT_BRIDGE_PORT`, `PRINT_BRIDGE_HOST`, `PRINT_BRIDGE_ORIGINS`,
`PRINT_BRIDGE_TOKEN`, `PRINT_TRANSPORT`, `PRINT_PRINTER`,
`PRINT_NETWORK_HOST`, `PRINT_NETWORK_PORT`, `PRINT_SPOOL_DIR` — all read by
`pnpm print-bridge`, never by the browser. The bridge binds to `127.0.0.1`.

---

## D. Configuration outside the codebase (dashboards)

| Where | What must be set |
| --- | --- |
| Paystack dashboard | Business/domain verified; callback URL `https://<domain>/?checkout=return`; webhook `https://<domain>/api/webhooks/paystack` + secret hash; test keys while testing |
| Commerce Supabase | Site URL + redirect URLs for `<domain>`; Auth SMTP sender (Phase 1); row-level security verified against the anon key |
| POS Supabase | Site URL; backups enabled (Phase 5) |
| DNS | `<domain>` A/CNAME → hosting; must resolve before Supabase redirects or Paystack callbacks work |

---

## Hard rules

1. **Never** copy a POS credential into the commerce project or vice versa —
   they are different Supabase projects by design (see `landing/docs/02`).
2. **Never** prefix a secret with `VITE_` — Vite inlines those into the public
   bundle that every visitor downloads.
3. Never commit `.env` files (`.gitignore` covers them; the repo tracks only
   `.env.example` with placeholders).
4. Rotate anything that has ever been printed in a log, a screenshot or a chat.
