# SamTill POS — Database & Sync

## Read this first: how the app and Supabase relate

The app is **local-first**. It authenticates against its own accounts and keeps
all state in `localStorage`. Supabase is a **one-way mirror**: every change is
pushed out as a fire-and-forget upsert, so the database is a live backup you can
query, report on, and audit — not the source of truth the UI reads from.

```
UI → DatabaseService (localStorage) → src/lib/sync.ts → Supabase
                                          ↑
                              deterministic UUID mapping
```

- The app never calls Supabase Auth, so `auth.uid()` is always `NULL`.
- The **only** reads happen during sign-in (see below). Otherwise the app keeps
  working with the network down; the row simply isn't mirrored until the next
  write.
- Writes are **never** awaited in the UI. A failed mirror logs a warning to the
  console and does not block or surface an error to the user.

### What sign-in reads back

A device that has never seen a shop would otherwise sign in to nothing. When
`login()` finds no local match it probes the mirror for that one account, then
**adopts** — never copies back — everything a till needs to open:

| Table | Scope | Why |
| --- | --- | --- |
| `users` | the matched row | the account signing in |
| `tenants`, `branches` | that shop | somewhere to open |
| `product_categories`, `products`, `customers` | that shop, whole | what the till sells |
| `sales` | that shop, 500 most recent | invoices to reprint |

Each table is fetched once, stored without being re-pushed (the mirror already
holds it), and skipped entirely when the device already carries rows for that
tenant — so a till seeded locally keeps its own. Every id is registered with
`bindMirrorId`, so a later write or a realtime event lands on the row that was
adopted instead of minting a second copy under a freshly hashed id.

Rows are normalised by `src/lib/mirrorRows.ts` on the way in: the mirror stores
blank `sku`/`unit`/`phone` as `NULL`, and handing those straight to the till
would throw the moment it called `product.sku.toLowerCase()`.

A **super admin has no shop to scope to**, so `adoptRemoteFor` pulls the whole
platform instead: every tenant, branch, staff row, category and product the
session can read (RLS re-derives super-admin on every query), plus the 2,000
most recent sales across all shops. This is what the Super Admin Dashboard
renders — without that pull the dashboard only ever showed the one browser's
`localStorage` snapshot, whatever the database held. The pull is idempotent
(only missing rows are added, deduped against each row's mirror UUID) and
coalesced so a sign-in triggered from both `login()` and the auth-state
listener cannot race itself into duplicates; it re-runs on every Supabase
session event, so a reload catches up with rows created while the tab was
closed.

**Not yet adopted:** `inventory_movements` and `expenses`. A stock book built
from a partial ledger would report wrong balances, so the device that owns the
history keeps it — Stock Book and expense reports start empty on a second
device rather than guess.

### Why that matters for security

**Row Level Security is relaxed on these tables so the anon key can write.**
Since there is no Supabase Auth session, `auth.uid()` is `NULL`, and strict
policies would reject every insert — which is exactly why the mirror silently
produced zero rows before this was fixed.

> ⚠️ **Before exposing this project publicly, adopt Supabase Auth and re-enable
> RLS.** As shipped, anyone holding the anon key (it is in the client bundle)
> can read and write every row in the project. That is acceptable for a
> single-machine till or a private LAN, and it is *not* acceptable on the open
> internet. The migration that relaxes the policies is marked clearly in
> `supabase/migrations/`.

## How app ids become UUIDs

The schema declares every primary key as `UUID`, but the app mints readable
string ids (`tenant-1761…`, `prod-42`, `branch-main`, `reg-01`). Sending those
straight to Postgres fails a cast on every row.

`src/lib/sync.ts` maps them at the boundary:

- `toUuid(appId)` — deterministic (FNV-1a → UUID v5 shape, fixed namespace), so
  the same app id always produces the same UUID. Re-syncing **upserts** the row
  instead of creating a duplicate.
- `fromUuid(uuid)` — the reverse lookup, used to recognise realtime payloads
  for rows this tab wrote or adopted so they are merged, not appended a second
  time under a UUID. An *unresolved* uuid is the signal that the row came from
  another session: `src/lib/realtimeRows.ts` adopts it instead of dropping it.
- App ids are never rewritten. The UI, tests, and `localStorage` keep using
  `tenant-…` / `prod-…`.

Nullable app ids (`''`, `undefined`) become SQL `NULL`, never an empty string.

### Ordering: parents before children

`tenants` is still a foreign key on `products`, `sales`, `expenses`, `users` and
`inventory_movements`. A child row that reaches the database before its tenant
would be rejected — the same silent-loss failure this module exists to fix. All
writes therefore go through a single **FIFO queue**, and each child write
prepends an upsert of its tenant. Once a tenant's insert is acknowledged it is
not re-sent for subsequent rows.

Failures are caught inside the chain, so one bad row can never wedge the queue
for everything behind it.

## Migrations

Run these in order in the Supabase SQL Editor (they are all idempotent — safe
to re-run).

| File | What it does |
|---|---|
| `20261020000001_initial_schema.sql` | Original schema, RLS, seed plans. |
| `20261024000001_stock_book_and_categories.sql` | Stock-book columns, category hierarchy, widened movement types. |
| `20261024000002_app_sync_compat.sql` | Creates `public.users`, adds the `sales`/`products`/`customers` columns the app sends, drops foreign keys pointing at empty `profiles`/`auth.users`, relaxes RLS for anon writes. |
| `20261024000003_mirror_unique_constraints.sql` | Drops four UNIQUE constraints the app does not enforce, which were discarding valid mirrored rows (see below). |
| `20261024000004_realtime_users.sql` | Adds `public.users` to the `supabase_realtime` publication so deleting or disabling a cashier reaches other open sessions (see below). |
| `20261029000001_lockdown_rls_and_scrub_credentials.sql` | Locks the mirror down: scrubs stored `password`/`pin` columns, revokes every `anon` grant (writes now require a Supabase Auth session), and re-grants `authenticated` the access the policies govern. |
| `20261030000001_provisioning_rpc.sql` | The trusted shop-provisioning RPCs: `create_tenant_with_owner`, `invite_staff`, `claim_legacy_profile`. **Without this migration, shop-owner registration fails** with a "could not find the function" error from PostgREST. |
| `20261030000002_realtime_tenants.sql` | Adds `public.tenants` to the same publication, closing the gap noted below — a shop registered from another browser now reaches an open Super Admin Dashboard. |
| `20261030000003_tenant_membership_read_policy.sql` | Adds the missing `SELECT` policy on `public.tenant_memberships` (`user_id = auth.uid()`). **Without this migration, a shop owner who registers a shop cannot sign in** — see below. |

### Why `20261024000002` was needed

Four independent causes meant every single write failed, and each failure was
swallowed:

1. **`public.users` did not exist.** The schema had `profiles`, whose `id` is a
   foreign key to `auth.users` — which stays empty because the app never calls
   Supabase Auth.
2. **RLS blocked everything.** Policies gated writes on `auth.uid()`; with no
   auth session that is `NULL`.
3. **`sales` was missing columns** the app sends (`shop_name`, `cashier_name`,
   `customer_name`, `payment_details`, `items`).
4. **Foreign keys to `profiles`** (`audit_logs.user_id`,
   `product_categories.deactivated_by`, `expenses.recorded_by`) pointed at a
   table that never has rows.

### Why `20261024000003` was needed

A mirror's job is fidelity, so a constraint stricter than the app's own rules
is a silent data-loss path:

| Constraint | Problem |
|---|---|
| `users.email` | Each browser bootstraps the super admin from `VITE_SUPER_ADMIN_EMAIL` with its own `user-<timestamp>` id. A second browser/origin upserts the same email under a different UUID → 409, account never stored. |
| `tenants.slug` | Derived from the shop name, so two shops with the same name collide — and the tenant is the head of every FK chain, so its products and sales go with it. Never looked up as a key. |
| `sales(tenant_id, invoice_number)` | `invoice_number` is `REC-` + last 6 digits of `Date.now()`, which repeats every ~16.7 minutes. A duplicated invoice number in a backup beats a missing sale. |
| `products(tenant_id, barcode)` | `addProduct` does not reject a barcode already in use in the same shop. |

`product_categories(tenant_id, name)` is deliberately **left UNIQUE** —
`addCategory` rejects duplicates before syncing, so it can never reject a row
the app considers valid.

### Why `20261024000004` was needed

Deleting a cashier is only "real time" if the deletion reaches sessions other
than the one that performed it. Supabase Realtime will not broadcast a table
that is not in the `supabase_realtime` publication, and `public.users` never
was — the publication was seeded with `sales`, `products`,
`inventory_movements` and `cash_register_shifts`, and `product_categories` was
added in `20261024000001`.

The failure mode is completely silent: the client subscribes, Supabase accepts
the subscription, and the handler simply never fires. Nothing is logged and no
error is returned, so a delete would look like it worked on the originating
device while every other till kept showing the removed cashier.

RLS and the `DELETE` grant for `anon` were already in place from
`20261024000002`, so this migration is only the publication entry.

The same silent gap had already been noted for `public.tenants` — subscribed
by the app but unpublished, so `handleRealtimeTenant` never fired and a shop
registered in another browser never reached an open dashboard.
`20261030000002_realtime_tenants.sql` closes it the same way.

### Why `20261030000003` was needed

Symptom: a shop registers successfully, but the owner cannot sign in —
*"This account is not linked to an active shop. Contact your administrator."*

The registration and sign-in paths touch `tenant_memberships` in opposite
ways:

- **Registration** (`create_tenant_with_owner`) is `SECURITY DEFINER`: it runs
  as the function owner, bypasses RLS, and inserts the membership row with no
  policy required. That's why signup "works".
- **Sign-in** (`resolveAuthUser`) reads `tenant_memberships` *as the
  authenticated owner* to prove the identity belongs to an active shop. That
  read is subject to RLS — and the table had RLS **enabled** with **zero
  policies** anywhere in the migration history, so Postgres filtered out every
  row. The membership exists but its own owner could never read it back.

The fix is one `SELECT` policy scoped to `user_id = auth.uid()`: a user sees
only their own memberships. No write policy is added — membership writes stay
the exclusive job of the trusted RPCs, so a tampered client still cannot mint
itself a membership.

Sign-in also has a third step: reading the `public.users` roster row by
email. The provisioning RPC deliberately does **not** create that row (it is
the app-managed staff list, written when an owner invites staff), so without a
further change the owner would just hit the next error, `no_roster`.
`resolveAuthUser` therefore treats the roster row as **optional** when a
verified profile + active membership already exist: the roster row is still
used when present (including its `is_active` check), but when absent the user
is built from `profile.role` (escalation-trigger-protected) plus the active
membership, with the shop name fetched from `tenants`. A genuine roster *read
failure* (network/permission) still returns `no_roster` rather than being
swallowed.

## Tables the app actually writes

| Table | Notes |
|---|---|
| `tenants` | Supermarkets. `subscription_status` ∈ active/trial/past_due/suspended/cancelled. |
| `branches` | One `MAIN` branch per shop, created with the tenant. |
| `users` | **The app's accounts**, not `profiles`. Includes `password` and `pin`. Role ∈ super_admin/shop_owner/cashier/shop_admin. |
| `products` | `unit` is free text in the app (`Pack`, `Bottle`, …), not a `product_units` row. |
| `product_categories` | Hierarchy via `parent_id`; `is_active` / `deactivated_at` for deactivation. |
| `sales` | **One row per sale** with a JSON `items` snapshot. `sale_items` is intentionally not written — its independent FKs would partially reject receipts. |
| `inventory_movements` | The stock ledger: `product_name` and `created_by_name` keep history readable if the product or operator is renamed. |
| `customers` | Includes `total_spent`. |
| `expenses` | `expense_date` is a DATE; the app's ISO timestamp is truncated. |
| `audit_logs` | Local-first trail of every mutation. |

Not written: `profiles`, `registers`, `tenant_memberships`, `payments`,
`cash_register_shifts`, `subscription_plans`, `sale_items`. The app holds those
in `localStorage` only.

## Backfill

Sync has always fired only on a *new* write, so anything created before the
fix existed solely in the browser. On a successful connection
`backfillExistingData()` mirrors everything already in `localStorage`. Because
`toUuid` is deterministic and every write is an upsert, this runs on every start
without duplicating rows.

## Verifying

Scripts live in `scripts/` and need `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
in the environment (`tsx` does not load `.env` on its own — export them first).

```bash
pnpm exec tsx scripts/db-status.ts     # row counts, migration markers, anon write probe
pnpm exec tsx scripts/db-rows.ts       # actual rows + duplicate detection
pnpm exec tsx scripts/db-verify.ts     # 20 end-to-end checks using the app's own mappers
```

`db-verify.ts` is the meaningful one: it imports `src/lib/sync.ts` so it tests
exactly what the browser sends rather than a hand-written copy that could drift,
pushes a full scenario, reads every row back, then cleans up after itself.

Related: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`.
