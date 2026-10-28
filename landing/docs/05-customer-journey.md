# 05 — Customer Journey (Register → Verify → Login → Download)

**Status:** Implemented behind feature flags — `accountEnabled = false` and
`downloadEnabled = false` in production until SamTill activates it (see the launch
checklist below). No production Supabase project exists yet; nothing is live.

This document is the canonical reference for the customer-account half of the
commerce platform: what the customer sees, which files implement each step, what
external configuration is still required, and how the flow was tested.

## 1. The journey

1. **Website (anonymous).** `/#/register` and `/#/download` render explanatory
   gate notices while the flags are off. The homepage, pricing table and docs are
   unchanged.
2. **Register** (`/#/register`). Email, password, full name and an optional
   phone number — the exact fields the `profiles` table stores, nothing more
   (no shop details, no ID numbers; a website account is not a POS tenant and
   does not activate a licence). Client-side validation mirrors the schema
   (email format, password 8–200 chars and not only spaces, name ≤ 120 chars,
   phone format when given). The browser sends **no** profile row and **no**
   role of any kind — the `profiles` row is created by a `security definer`
   trigger on `auth.users` (`db/migrations/0001_commerce_init.sql`), so there
   is no client write path that could be used to self-assign a privileged
   role. The provider's response is neutral ("check your inbox") whether or
   not the account already existed, so registration cannot be used to
   enumerate accounts. The page explicitly states that a licence is a
   separate purchase/activation.
3. **Verify email.** Supabase Auth sends the confirmation email, which links
   to `/#/verify?token_hash=...&type=signup` (or `?code=...` in the PKCE
   flow). The page exchanges those parameters with the provider and shows
   "verified" **only** when a session comes back. A plain visit, an expired
   link, a reused link or a malformed one each produce a specific, honest
   failure message with a way forward. There is no polling and no
   client-side "verified" flag; the provider's answer is the only source of
   truth.
4. **Login** (`/#/login`). `signInWithPassword`. When the provider reports the
   address is unconfirmed (`email_not_confirmed`), the page shows a dedicated
   panel with a **Resend the confirmation email** button. Sessions are stored
   in `localStorage` by supabase-js; on mount the session hook re-validates the
   persisted session with `getUser()` (a server round-trip), so a session
   revoked or deleted server-side resolves to signed-out instead of being
   served from the stale cache. The real security boundary remains the
   server-side check inside `POST /api/download`.
5. **Account page** (`/#/account`). Protected: with no confirmed session it
   renders an inline "sign in" notice instead of the account content. Shows
   identity, the verification state (from the server-confirmed session user),
   and the licence status ("No licence activated - licences are managed
   separately from accounts"). Sign-out clears the local session.
6. **Download page** (`/#/download`). Protected. Two access modes
   (`DOWNLOAD_ACCESS_MODE` on the API):
   - `entitlement` (**default, unchanged behaviour**): `POST /api/download`
     with the bearer access token; the API requires an active entitlement row
     for `samtill-pos` before issuing a short-lived signed URL. Customers
     without one get a neutral "no installer downloads yet" message.
   - `verified_account` (opt-in; the recommended policy for the payments-free
     first release): the same call succeeds only for an account whose email
     address is **confirmed**. Confirmation is checked **server-side,
     authoritatively**, against the commerce project's Auth Admin API (a
     service-role lookup in `api/_lib/auth-admin.ts`) -- a valid access token
     alone is deliberately *not* treated as proof, because a project with
     "Confirm email" disabled issues tokens for unconfirmed users. An
     unconfirmed address is denied (`email_unverified`) and that refusal is
     audited. This grants download ACCESS ONLY; it is never a subscription,
     licence or payment confirmation.
    The installer details in the response (version, filename, size, SHA-256)
    come from the `installer_releases` row the **server** selected; the client
    cannot choose a version or a storage path. The page downloads via the
    short-lived signed URL it was issued, shows the real size and hash so the
    file can be verified, and carries a Windows-only notice distinguishing the
    installer from the web/PWA app.
7. **Errors are honest.** Missing installer -> `403 download_unavailable`, and
   the UI explains the file is not published yet. Expired/invalid session ->
   `401`, and the UI asks the customer to sign in again. Rate limited ->
   `429` with the wait time. Network failure -> the real error message is
   shown; nothing is faked.

## 2. What was added (file by file)

**Shared logic (pure, unit-tested):**
- `src/lib/validation.ts` — registration field validation (email format, password
  length, full-name length, optional phone format).
- `src/lib/availability.ts` — central gate check used by the nav, routes and
  pages.
- `src/lib/hashRoute.ts` + `src/lib/useHashRoute.ts` — tiny hash router (no new
  routing dependency) so the static build works on any host.
- `src/lib/authFlow.ts` — supabase-independent orchestration: register, sign in,
  sign out, session restore, verification link exchange, password reset, resend,
  download-access mode evaluation.
- `src/lib/downloadClient.ts` — client for `POST /api/download` and
  `GET /api/status`; classifies every server answer honestly (session expired,
  denied with reason, rate limited, missing installer, network failure).
- `src/lib/commerceClient.ts` + `src/lib/supabaseAdapter.ts` — the existing
  prepared commerce API wiring, now backed by a real supabase-js auth client when
  `VITE_COMMERCE_SUPABASE_URL` / `VITE_COMMERCE_SUPABASE_ANON_KEY` are set.
- `src/lib/useAccountSession.ts` — React session state (loading / signed-in /
  signed-out). Re-validates the persisted session with `getUser()` on mount, so
  a session revoked server-side is not served from the stale localStorage copy.
  (UX guard only; the security boundary is the API.)
- `src/lib/navigation.ts` — canonical hash paths.

**UI:**
- `src/pages/RegisterPage.tsx`, `LoginPage.tsx`, `VerifyEmailPage.tsx`,
  `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `AccountPage.tsx`,
  `DownloadPage.tsx`.
- `src/components/account/{AccountShell,TextField,StatusBanner,GateNotice}.tsx`.
- `src/App.tsx` (routes + guards), `src/components/Nav.tsx` (Sign in /
  Create account / Download links appear only when the flags are on),
  `src/components/CommercePreview.tsx`, `src/components/Footer.tsx`,
  `src/components/Faq.tsx` (all now flag-aware; byte-identical output
  while the flags are off).
- `src/config/site.ts` gained `webAppUrl: ''`.

**API:**
- `api/_lib/env.ts` — new validated `downloadAccessMode` setting
  (`entitlement` | `verified_account`, default `entitlement`; anything else is
  a config error).
- `api/download.ts` — mode branch. `entitlement` keeps the entitlement check
  verbatim. `verified_account` performs an authoritative server-side email
  confirmation lookup and denies `email_unverified` when the address is not
  confirmed. No secrets or signed URLs are returned to the browser beyond the
  existing single, short-lived redirect.
- `api/_lib/auth-admin.ts` — service-role lookup of a commerce user against
  the Auth Admin API, used only to answer "is this address confirmed?".
  Fails closed: a lookup error is surfaced as a backend error, never as
  access.
- `api/_lib/entitlement.ts` — added `email_unverified` deny reason and the
  pure `decideVerifiedAccountDownload()` policy helper.
- `api/status.ts` — now reports `downloadAccessMode` for diagnostics.

**Dependency:** `@supabase/supabase-js@^2.118.0` (auth + REST client for the
separate `samtill-commerce` Supabase project). No Prisma, no Neon, no new
database.

**Docs:** this file, plus updates to `01-commercial-decisions.md`,
`02-commerce-architecture.md`, `03-environment-variables.md`,
`04-installer-delivery-and-licensing.md`, `api/README.md` and the root
`README.md`.

## 3. Isolation and the shop/tenant question

- The customer journey belongs to the **separate `samtill-commerce` Supabase
  project** (never the POS project), selected by `VITE_COMMERCE_SUPABASE_URL` /
  `VITE_COMMERCE_SUPABASE_ANON_KEY` in the browser and the server's own commerce
  env vars.
- **There is no shop or tenant mapping.** SamTill sells one product directly;
  customer records are global and are never joined to POS `shops`, `users`,
  `roles` or `tenants`. Any future multi-shop mapping must be designed and
  approved separately. Creating a website account therefore does **not**
  provision, activate or modify a POS shop.
- **Roles: there is no client-writable role at all.** The commerce schema has
  no `user_roles` table and the browser has no write path to any table — every
  table is RLS-enabled with either no policy (service-role only) or a single
  select-own policy on `profiles`. The `profiles` row is created by a
  `security definer` trigger on `auth.users`, so a customer cannot insert or
  update a row, let alone assign themselves `admin` or `super_admin`.

## 4. Required external configuration (not done here — needs the owner)

1. Create the `samtill-commerce` Supabase project (separate from the POS project).
2. Run, after review and approval, the SQL in
   `db/migrations/0001_commerce_init.sql` (profiles + trigger, plans, orders,
   subscriptions, entitlements, installer_releases, download_events,
   webhook_events, audit_logs, the private `installers` bucket, and the RLS
   hardening) — **no SQL was executed in this change**.
3. Enable Email/Password sign-in and set the **Site URL** plus the email
   confirmation redirect to the real production domain's verify route
   (`https://<owner-chosen-domain>/#/verify`). **`samtill.com` does NOT
   resolve in DNS** as of this writing, so the owner must choose and point
   a real domain first. Configure the email provider (never committed
   here).
4. Set `DOWNLOAD_ACCESS_MODE=verified_account` on the API if SamTill wants
   verified accounts to download without a subscription (the default
   `entitlement` mode keeps the old behaviour).
5. Flip `COMMERCE.accountEnabled` and `COMMERCE.downloadEnabled` to `true` in
   `src/config/commerce.ts` and deploy.

## 5. Tests

`pnpm test` (Node test runner, `tests/run.ts`) — **125 passing tests**:

- `tests/account-logic.test.ts` — registration validation rules, gate defaults,
  hash-route helpers, auth-flow state machine (success, duplicate email,
  unverified login, verification link exchange success/failure, password-reset
  confirmation handling, resend).
- `tests/download-flow.test.ts` — real `api/download.ts` handler executed with
  stubbed `fetch`/env: entitlement mode requires an active entitlement row and
  performs no auth-admin lookup; `verified_account` mode performs the
  authoritative email-confirmation lookup and grants only confirmed accounts;
  an unconfirmed address is denied with `email_unverified` and audited as
  `denied_unverified_email`; a failed lookup fails closed (502); anonymous or
  invalid token -> 401; missing installer -> `download_unavailable`; failed
  audit write -> 503 with no link handed out; plus the pure
  `decideVerifiedAccountDownload()` policy and its audit vocabulary.

Not tested here (documented honestly): real email delivery, real Supabase
sessions, and a real file download — these need the `samtill-commerce` project
and a production file upload, both pending owner approval.

## 6. Security notes

- The browser only ever holds the Supabase **anon** key; the service-role key
  and all Paystack/email secrets stay server-side in Vercel env vars.
- No signed URL is embedded in the client; the API issues one short-lived,
  server-signed redirect per authorised request.
- Download authorisation is server-side; forging a client request does not bypass
  it.
- `pnpm lint`, `pnpm test` and `pnpm build` all pass; a grep of the built bundle
  finds no secrets, JWTs or tokens (only supabase-js's own string detector and
  the `/api/download` endpoint path).
