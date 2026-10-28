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
   phone format when given). A Supabase **anonymous session** is created
   so the new user is authenticated from the moment the account row is inserted —
   the row-level-security policy in the planned `samtill-commerce` project allows
   an insert only for `auth.uid() = id`, which makes role self-assignment
   impossible. Server response is neutral ("check your inbox") whether or not the
   account already existed, so registration cannot be used to enumerate accounts.
   The page explicitly states that a licence is a separate purchase/activation.
3. **Verify email.** Supabase Auth sends the confirmation email. The app polls
   the session (2 s, up to 20 s) and reads `user.email_confirmed_at`; the UI only
   ever says "verified" when that timestamp is actually present. "Resend email"
   calls the auth `resend` endpoint. No verification claim is ever made from a
   client-side flag.
4. **Login** (`/#/login`). `signInWithPassword`; unverified accounts are refused
   with a clear "verify your email first" message and a resend link. Sessions are
   stored in `localStorage` by supabase-js, so a browser refresh restores the
   session through `getUser()` (server-side session validation, not a cached
   flag).
5. **Account page** (`/#/account`). Protected: only rendered for a confirmed
   session; otherwise it redirects to `/#/login`. Shows identity, verified state,
   and the licence status ("No licence activated — licences are managed
   separately from accounts"). Sign-out clears the local session.
6. **Download page** (`/#/download`). Protected. Two access modes
   (`DOWNLOAD_ACCESS_MODE` on the API):
   - `entitlement` (**default, unchanged behaviour**): calls `POST /api/download`
     with the bearer access token; the API requires an authenticated
     subscription (`/v1/billing/subscription`) before issuing a short-lived
     signed download session. Verified accounts without a subscription get a
     neutral "no licence yet" message with a link back to pricing.
   - `verified_account` (opt-in, not enabled anywhere yet): the same API call
     succeeds for any **email-verified** account, because SamTill decided the
     first public release should let verified accounts download the installer
     before payments are switched on. This is an explicit owner decision recorded
     in `01-commercial-decisions.md`; it does not activate or imply a licence.
   The page shows the real installer details (name, version, size, SHA-256 —
   read from `GET /api/status`, never hard-coded in the client), a progress bar
   driven by actual `fetch`/`ReadableStream` progress, and a Windows-only notice
   distinguishing the installer from the web/PWA app. The href is always the API
   endpoint, so no signed URL is ever baked into the bundle.
7. **Errors are honest.** Missing installer → the API returns
   `installer_unavailable` and the UI explains the file is not on the server yet.
   Expired/invalid session → 401, the UI returns the customer to the login page.
   Network failure → the real error message is shown; nothing is faked.

## 2. What was added (file by file)

**Shared logic (pure, unit-tested):**
- `src/lib/validation.ts` — registration field validation (email format, password
  length, full-name length, optional phone format).
- `src/lib/availability.ts` — central gate check used by the nav, routes and
  pages.
- `src/lib/hashRoute.ts` + `src/lib/useHashRoute.ts` — tiny hash router (no new
  routing dependency) so the static build works on any host.
- `src/lib/authFlow.ts` — supabase-independent orchestration: register, sign in,
  sign out, session restore, verification polling, password reset, resend,
  download-access mode evaluation.
- `src/lib/downloadClient.ts` — client for `POST /api/download` and
  `GET /api/status` with abortable streaming and real progress.
- `src/lib/commerceClient.ts` + `src/lib/supabaseAdapter.ts` — the existing
  prepared commerce API wiring, now backed by a real supabase-js auth client when
  `VITE_COMMERCE_SUPABASE_URL` / `VITE_COMMERCE_SUPABASE_ANON_KEY` are set.
- `src/lib/useAccountSession.ts` — React session state (loading / signed-in /
  signed-out) with server-side `getUser()` validation on mount and on
  `visibilitychange`.
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
- `api/_lib/env.ts` — new validated `downloadAccessMode` setting.
- `api/download.ts` — mode branch (`entitlement` keeps the subscription check
  verbatim; `verified_account` uses `getUser()` and requires
  `email_confirmed_at`). No secrets or signed URLs are returned to the browser
  beyond the existing single, short-lived redirect.
- `api/status.ts` — now reports `downloadAccessMode` for diagnostics.
- `api/_lib/commerceApiAuth.ts` — tiny hook added so an existing bearer token is
  reused instead of minting an anonymous session per request (fixes a latent
  bug: downloads previously always ran as the anonymous role).

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
  approved separately.
- Roles: the planned `user_roles` RLS policies allow a user to read only their
  own rows and allow no client-side inserts/updates at all, so a customer can
  never self-assign `admin` or `super_admin`.

## 4. Required external configuration (not done here — needs the owner)

1. Create the `samtill-commerce` Supabase project (separate from the POS project).
2. Run, after review and approval, the SQL in
   `db/migrations/0001_commerce_init.sql` (accounts extension,
   `installer_releases`, `download_events`, `user_roles`, storage bucket, RLS)
   — **no SQL was executed in this change**.
3. Enable Email/Password sign-in; set the confirmation link to
   `https://samtill.com/#/verify`; configure the email provider (never
   committed here).
4. Set `DOWNLOAD_ACCESS_MODE=verified_account` on the API if SamTill wants
   verified accounts to download without a subscription (the default
   `entitlement` mode keeps the old behaviour).
5. Flip `COMMERCE.accountEnabled` and `COMMERCE.downloadEnabled` to `true` in
   `src/config/commerce.ts` and deploy.

## 5. Tests

`pnpm test` (Node test runner, `tests/run.ts`) grew from 68 to 120 passing tests:

- `tests/account-logic.test.ts` — registration validation rules, gate defaults,
  hash-route helpers, auth-flow state machine (success, duplicate email,
  unverified login, verification polling success/timeout, password-reset
  confirmation handling).
- `tests/download-flow.test.ts` — real `api/download.ts` handler executed with
  stubbed `fetch`/env: entitlement mode requires a subscription; verified-account
  mode requires an authenticated, email-verified user; anonymous token → 401;
  missing installer file → `installer_unavailable`; signed-URL failure → 502;
  the response redirects to the real `/releases/…exe` path.

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
