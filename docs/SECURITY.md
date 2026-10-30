# SamTill POS — Security Model, Account Migration & Stage C Runbook

> Status: **Design + local implementation only.** Nothing in this file has been
> applied to any production database or service. Every external step below
> requires explicit owner approval before it is executed.

## 1. Threat model that drives every decision

The audit established one root cause and several consequences:

| # | Fact | Consequence |
|---|------|-------------|
| 1 | The POS talks to Supabase with the **anon key and no Auth session** | The anon key ships in every install, so **RLS cannot be the boundary while anon holds table grants**. |
| 2 | `VITE_*` vars were inlined into `dist/` and the (now removed) Electron `app.asar` | **Any secret in a `VITE_` var shipped to every install.** The super-admin password was in a distributed binary. |
| 3 | `getEnvVar` used **dynamic** `import.meta.env[key]` | Vite injected the **entire** env object, so deleting the last code reference did **not** remove the secret from the bundle. |
| 4 | The app keeps its own accounts in `public.users` with **plaintext `password`/`pin`** | Credentials were readable by any anon holder and mirrored verbatim. |
| 5 | `register()` / `addUser()` trusted a client-supplied `role` | A tampered client could mint `super_admin`. |

**Stage A** closed 2/3/4/5 in application code and proved the fresh web bundle
and installer contain **no** super-admin credential.
**Stage B** (migration, unapplied) closes 1 and the residual DB-resident
plaintext, and blocks row-level role escalation.
**Stage C** (this runbook, unexecuted) rotates the compromised credential and
provisions Supabase Auth.

## 2. Environment access rule (why the fix is `import.meta.env?.VITE_X`)

```ts
// CORRECT — static member access + optional chaining
const ENV_SUPABASE_URL: string = import.meta.env?.VITE_SUPABASE_URL ?? '';
```

- **Static member access** (`import.meta.env.VITE_X`, never `[key]`) lets Vite
  replace *only* the referenced var at build time. Dynamic access forces the
  whole env object into the bundle — that is how the secret survived its own
  deletion.
- **Optional chaining (`?.`)** is required because under `tsx`/Node (the test
  runner) `import.meta.env` is `undefined`. A bare `import.meta.env.VITE_X`
  throws at module load and breaks every test that imports the client.

**Rule:** every env read in this app must be a statically-referenced optional
chain. A `VITE_` var must never hold a password, service-role key, or Paystack
secret.

## 2b. RLS policy rule — never widen an existing policy by adding a broader one

PostgreSQL **ORs** policies together for a given (role, command). Adding a new,
broader policy does not replace a narrower one — it silently defeats it. The
first Stage B draft wrapped nearly every table in `FOR ALL TO authenticated`
using only `user_tenant_ids()` (a *member* check). That would have widened three
deliberate, narrower protections established earlier:

| Table | Existing intent (must NOT widen) | What a blanket `FOR ALL` would have done |
|-------|----------------------------------|------------------------------------------|
| `product_categories` | member SELECT, **owner-only** INSERT/UPDATE, **no DELETE** (`is_tenant_owner`) | Let cashiers create/edit categories. |
| `inventory_movements` | member SELECT, **owner-only** INSERT, **no UPDATE/DELETE** (append-only ledger) | Let any member silently rewrite or erase stock history. |
| `tenants` | member SELECT; owner UPDATE; **INSERT ungranted** (server-side signup) | Let any member create arbitrary tenants. |

The corrected migration therefore: **(a)** adds policies *only* for tables that
have none (`users`, `branches`, `customers`, `expenses`, `audit_logs`), scoped by
command and role (`is_tenant_member` vs `is_tenant_owner`); **(b)** leaves the
existing `products`/`sales`/`sale_items`/`product_categories`/`inventory_movements`
policies untouched (dropping only the permissive *anon* ones); **(c)** pins
`search_path` on the SECURITY DEFINER helpers.

**Rule:** before adding any policy, list the policies that already exist for that
table and command. If a narrower one exists, drop-and-rewrite it deliberately —
never blanket-grant over it.

## 3. Offline-first authentication design (preserves sales during outages)

The POS is local-first: a sale is written to the in-memory/local store **first**
(`recordSale` → `this.sales.unshift`) and mirrored to Supabase fire-and-forget
(`syncSale`) only when a client exists. **Recording a sale never depends on a
network call or an auth round-trip**, so a network outage cannot block a till.

The agreed interaction model once Supabase Auth is live:

| Situation | Behaviour |
|-----------|-----------|
| **Previously authenticated user, network outage** | The Supabase session (access + refresh token) is persisted locally. The till opens and records sales offline. Queued sales sync when connectivity **and** a valid session return. |
| **Empty/absent password or PIN** | Never a bypass. Stage A already made `login()` **refuse** an account with no stored credential. Under Auth this becomes "no valid session → no sign-in", never "no password → open". |
| **New / unprovisioned device** | Cannot reach protected **online** data: it has no session, so RLS denies every read. It may still be used as an offline-only till only after a prior successful sign-in on that device. |
| **Session expired** | Background refresh with the refresh token. If refresh fails, the user is returned to sign-in; **locally recorded sales are untouched** and the sync queue is preserved. |
| **Access revoked (deactivated / removed)** | The next successful refresh or sync returns 401/403; the session is dropped and the till requires re-authentication. Already-recorded sales are **not** discarded — they remain in the local store and the queue for an administrator to reconcile. |
| **Duplicate retry / conflict** | Every mirrored row is keyed by a deterministic UUID (`toUuid(appId)`) and upserted `onConflict: 'id'`, so a retried write is **idempotent**, not a duplicate. The FIFO queue serialises parent-before-child writes. |

**Non-negotiables encoded above:** offline sales survive reloads and outages;
no auth bypass on empty credentials; a new device cannot reach online data
without authenticating; the queue is durable and idempotent; **a failed sync
never silently drops a completed sale** (failures are surfaced, and the row
stays in the local store + queue); locally-cached role is **never** authoritative
for online access — RLS re-checks `auth.uid()` server-side on every request.

## 3b. Phase 2 — Supabase Auth implementation (local code, not yet against staging)

The online credential path now runs through Supabase Auth. This section
describes what is implemented in the client and the (unapplied) provisioning
migration. It is **code + reviewed SQL only** — nothing here has been executed
against a real Supabase project, and no end-to-end auth is claimed until it is
verified on staging (see the report's blockers).

### 3b.1 Two mutually exclusive login paths
`DatabaseService.login(identifier, password)` branches on whether a Supabase
client is configured:

- **Online (client configured).** Supabase Auth is the **only** credential
  check. The password is sent to `auth.signInWithPassword` and is **never**
  compared, stored or mirrored by the app. The application user is then resolved
  from `auth.uid()` (see 3b.2). Sign-in requires the account's **email** —
  Supabase Auth identifies users by email; phone/staff-name sign-in stays a
  device-local convenience. A *new* sign-in therefore needs the network; a user
  who already signed in keeps their persisted session and sells through an
  outage without re-prompting.
- **Device-local (no client).** The offline / not-yet-connected mode and the
  test harness. It matches an identifier the device already holds and compares
  against the locally stored credential. It is a real fallback, not a security
  boundary: it only grants access to data already on the device. Once a client
  is configured this path is unreachable.

### 3b.2 Resolving the user from `auth.uid()`
`resolveAuthUser` (in `src/lib/authProvider.ts`) reads, with **explicit column
lists** (never `select('*')`, and never `password`/`pin`):
1. `profiles.role` keyed by `auth.uid()` — the **authoritative** role. It is
   never taken from the client or inferred; the DB escalation trigger protects
   it from self-promotion.
2. `tenant_memberships` (`is_active`) — proof the identity belongs to an active
   shop. No active membership ⇒ sign-in refused.
3. `public.users` roster row by verified email — supplies `is_active`,
   `shop_name`, phone and the app-facing id.

A missing profile, missing active membership, missing roster row, or a
deactivated roster row is **refused** with a clear message — never silently
granted access.

### 3b.3 Session lifecycle
`initSupabaseClient` configures the client with `persistSession` +
`autoRefreshToken` (session survives reloads and browser restarts) and
subscribes to `onAuthStateChange`:
- `INITIAL_SESSION` / `SIGNED_IN` / `TOKEN_REFRESHED` → if no local user is
  loaded, re-resolve from `auth.uid()` (a reload restores the signed-in state
  without re-prompting).
- `SIGNED_OUT` → clear the in-memory user so no protected **online** operation
  proceeds. **Local data and the queued-sales outbox are never discarded.**
- `PASSWORD_RECOVERY` → surfaced via `statusMessage` so the UI can route the
  owner to set a new password.
`logout()` clears the local session **synchronously first**, then invalidates the
server session; a network failure during sign-out is swallowed so the user is
never stranded half-logged-out.

### 3b.4 Trusted provisioning (SECURITY DEFINER RPCs)
A new shop registration **never** inserts a tenant/profile/membership row from
the client. `registerOnline()`:
1. `auth.signUp` (password hashed server-side by Supabase; never stored here).
2. The SECURITY DEFINER RPC `create_tenant_with_owner`
   (`supabase/migrations/20261030000001_provisioning_rpc.sql`, **unapplied**),
   which runs inside the database, keys everything to `auth.uid()`, pins the
   role to `shop_owner`, and **cannot mint a super admin**.

If email confirmation is required, `signUp` returns no session and the RPC
cannot run yet (it needs `auth.uid()`); the UI asks the owner to confirm, and the
shop is finished on their first confirmed sign-in (`login` calls the same
idempotent RPC when a signed-in identity has no shop yet). The migration also
provides `invite_staff` (owner adds a team member, re-checked with
`is_tenant_owner` inside the DEFINER context, role restricted to
cashier/shop_owner) and `claim_legacy_profile` (a **confirmed** email links its
new auth identity to the existing roster row + membership — the controlled
re-invitation path). Every function is `SECURITY DEFINER`, pins `search_path`,
is `EXECUTE`-denied to `PUBLIC`/`anon` and granted only to `authenticated`, and
refuses a NULL `auth.uid()`.

## 4. Account migration design (plaintext → Supabase Auth)

**Goal:** every existing shop owner, cashier and super-admin becomes a Supabase
Auth user with the **same shop, role and tenant scope**, without importing a
single plaintext password and without ever auto-granting `super_admin`.

### 4.1 Why plaintext cannot be carried over
Supabase Auth hashes credentials server-side (bcrypt). There is no supported
import of an external plaintext/hash into a working Auth password. Therefore
**every account must establish a new password** — there is no silent migration
of the old one. Old `password`/`pin` values are scrubbed by the Stage B
migration and are never sent to Auth.

### 4.2 Mapping (reliable, keyed on email)
`public.users.email` is `UNIQUE`, so email is the join key:

```
public.users (app roster)              Supabase Auth            Link tables
------------------------------         ------------------       -------------------------
email  ──────────────────────────────► auth.users.email         (the join)
role, is_active  ─────────────────────► public.profiles.role     profiles.id = auth.uid()
tenant_id (nullable)  ────────────────► (no Auth equivalent)     tenant_memberships
                                                                  (user_id=auth.uid,
                                                                   tenant_id=app tenant)
```

- `public.profiles.id` already `REFERENCES auth.users(id)`, so a provisioned
  Auth user gets a one-to-one profile row carrying the **existing** role.
- Each `tenant_id` becomes a `tenant_memberships` row so `user_tenant_ids()`
  resolves the tenant for RLS.
- **Super-admin is never inferred.** Only accounts whose `public.users.role`
  is *already* `super_admin` receive `role='super_admin'` in `profiles`, and
  even that is written by the trusted service role (the Stage B trigger blocks
  a client from writing it). The migration and provisioning code must contain
  **no** logic that promotes an account to super-admin.

### 4.3 Provisioning method — Admin API + one-time invitation
Server-side only, using the **service-role key** (never in a `VITE_` var, never
in the browser/PWA, never in the repo):

For each existing `public.users` row:
1. `admin.createUser({ email, email_confirm: false, password: <random>, user_metadata: { app_role, tenant_id } })`.
2. Generate a single-use invite / recovery link (`admin.generateLink({ type: 'invite' })`) and deliver it out-of-band.
3. The user opens the link, **sets their own password**, and must verify email.
4. Insert `public.profiles` (role copied from the roster) + `tenant_memberships` rows **via the service role** (the Stage B trigger permits service-role writes because `auth.uid()` is NULL).

**If reliable automatic mapping is not possible** (e.g. duplicate/missing
emails, orphaned roster rows): fall back to a **controlled shop-owner
re-invitation** — the owner signs up fresh through the normal verified flow and
re-invites staff. This is slower but never guesses an identity and never risks
attaching the wrong tenant or role.

### 4.4 Recovery & re-invitation
- **Forgot password** → Auth email flow (Resend/SMTP). No human handling a password.
- **Staff creation** → the shop owner's authenticated dashboard calls the
  `provision-staff` Edge Function. It verifies the owner's active membership,
  creates the Auth identity with the password supplied by the owner, and uses
  `invite_staff` plus the owner-scoped roster policy to attach the Auth UUID to
  the shop. The password is never written to `public.users` or the online
  device mirror. The function must be deployed to the same Supabase project as
  the POS app. The owner is responsible for sharing the cashier's initial
  password through a secure channel.
- **Disabled users** → `is_active=false` in `profiles`; Auth sign-in is refused (already tested client-side; enforced server-side by RLS + the deactivated check).

## 5. Stage C — credential-rotation runbook (NOT YET EXECUTED)

> Treat the exposed super-admin credential as **compromised**. It was in a
> distributed installer. Every step below waits for explicit approval.

**1. Enumerate where the old credential still lives.**
   - `.env` (`VITE_SUPER_ADMIN_EMAIL` / `VITE_SUPER_ADMIN_PASSWORD`) — still present locally.
   - Any previously distributed `SamTill-POS-Setup.exe` / installed `app.asar`.
   - Any Vercel/Render dashboard env copies (if the POS is ever deployed there).
   - Human memory / password managers / old chat or docs.

**2. Establish a trusted replacement admin (do not reuse the exposed identity).**
   - Create the super-admin **Auth user via the Admin API** (or Supabase
     dashboard) with a **fresh, strong, never-before-used password** and a
     verified email you control. This is the only super-admin creation path.

**3. Rotate without locking anyone out.**
   - Provision the new admin (step 2) and confirm it can sign in **before**
     disabling the old identity. Keep a second break-glass admin so a lost
     credential cannot strand the platform.

**4. Remove the old credential from configuration (after confirming no dependency).**
   - Delete `VITE_SUPER_ADMIN_EMAIL` / `VITE_SUPER_ADMIN_PASSWORD` from `.env`.
     **No code references them any more** (Stage A removed the last read and the
     static-access refactor means they would not be shipped even if present),
     so removal is safe. Update `.env.example` (done) and any deployment env.
   - Rebuild `dist/` and re-scan to confirm absence (procedure proven
     in Stage A).

**5. Configure Supabase Auth safely (POS project only — never the commerce project).**
   - Enable Email provider; set SMTP via **Resend** (or Supabase's hosted SMTP).
   - Enable email verification on sign-up; set password-reset redirect to the POS origin.
   - Issue a **service-role key** for the provisioning script; store it only in a
     server-side secret store. Never expose it to client code or the repo.
   - Set session/access-token expiry and enable refresh-token rotation.

**6. Review exposure.**
   - Supabase Auth + Postgres logs around the compromised identity.
   - Active sessions/JWTs issued to the old identity — revoke.
   - Older distributed installers (historical; the Electron app has since been
     removed in favour of the PWA): any copy still in circulation holds the old
     credential **and** pre-Stage-A code, and can never receive an update.
     Rotation + Stage B are what actually neutralise them — plan to collect or
     discard those copies.

**7. Verify.**
   - Old credential no longer signs in anywhere.
   - Fresh web build contains no privileged credential (re-scan).
   - A normal user cannot self-assign `super_admin` (client test + DB trigger).
   - No client-side path grants privileged access.

## 6. Acceptance checklist before any production cutover

Automated (client-side) — **already passing**:
- [x] Register cannot self-assign a privileged role.
- [x] `addUser` cannot mint `super_admin` from a shop-owner **or** cashier session.
- [x] An existing super-admin session still may create a super-admin.
- [x] Login refused for accounts with no stored credential.
- [x] Wrong password rejected; deactivated account rejected; logout clears session.
- [x] `userRow` never mirrors `password`/`pin`.
- [x] Fresh web bundle contains no super-admin credential (the Electron installer that once shipped one has been removed).

Requires Stage B/C (server-side) — **not yet verifiable without the migration**:
- [ ] Anonymous users cannot read/write protected business data.
- [ ] An authenticated user cannot read another shop's rows (tenant isolation).
- [ ] A client cannot write `role='super_admin'` to `public.users` or `public.profiles` (DB trigger).
- [ ] Login/logout/session-expiry/recovery/provisioning via Supabase Auth.
- [ ] Offline sale recorded during an outage syncs exactly once after reconnect.
- [ ] POS PWA remains functional after cutover.
- [ ] Landing and POS point at their **intended, separate** Supabase projects.

## 7. Open decisions for the owner
1. Approve the revised Stage B migration (file `supabase/migrations/20261029000001_...sql`) — **not applied**.
2. Approve running the Stage C provisioning/rotation (external, needs accounts).
3. Email delivery: Resend account + domain, or Supabase hosted SMTP?
4. Automatic email-keyed mapping vs controlled shop-owner re-invitation for legacy accounts.
5. ~~Code-signing certificate purchase (SmartScreen trust for the installer).~~ — obsolete: the Windows installer has been removed; SamTill ships as a PWA installed via the browser.
