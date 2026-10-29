-- =============================================================================
-- Stage B (REVISED v2 — NOT APPLIED): Lock down RLS, scrub creds, block escalation
-- =============================================================================
--
-- WHY A SECOND REVISION (found in the FINAL pre-cutover review)
--   v1 wrapped almost every table in a blanket `FOR ALL TO authenticated`
--   policy. That is a SECURITY REGRESSION, because PostgreSQL ORs policies
--   together per (role, command): adding a broader policy silently defeats an
--   existing narrower one. Concretely, `20261024000001_stock_book_and_categories.sql`
--   already establishes DELIBERATE, narrower rules that v1 would have widened:
--     • product_categories : SELECT=member, INSERT/UPDATE=OWNER-only, NO DELETE.
--     • inventory_movements: SELECT=member, INSERT=OWNER-only, NO UPDATE/DELETE
--                            (an append-only ledger; corrections are reversals).
--   A blanket `FOR ALL` for every tenant member would have let a CASHIER create
--   or edit categories and silently rewrite the stock ledger. v2 therefore does
--   NOT blanket-grant. It only adds policies for tables that currently have NO
--   authenticated policy, and it LEAVES the correct existing policies in place
--   (dropping only the permissive anon ones).
--
--   v1 defects now fixed:
--     (1) WIDENING  — blanket FOR ALL OR-ed over narrower role-scoped policies.
--     (2) FATAL SQL — sale_items was scoped by a tenant_id column it does not
--                     have (keyed by sale_id). v2 leaves sale_items' existing,
--                     correct sale_id-scoped policy alone.
--     (3) ESCALATION — public.users.role and public.profiles.role were writable
--                     by their owners; both are trusted (App.tsx reads users.role,
--                     is_super_admin() reads profiles.role). Closed by trigger.
--     (4) BOUNDARY  — the trigger's provisioning pass-through is now EXPLICIT
--                     (see §7 note on why `auth.uid() IS NULL` is adequate only
--                     BECAUSE anon holds no grants in this same transaction).
--
-- PURPOSE
--   Close the two database-resident criticals from the audit:
--     (a) 12 tables wide open to `anon` (permissive policies from
--         20261024000002_app_sync_compat.sql), and
--     (b) plaintext `password`/`pin` still stored in public.users.
--   Afterwards every protected table requires an AUTHENTICATED Supabase Auth
--   session, scoped to that session's tenant, and privileged roles can no
--   longer be written by the very tenants they would govern.
--
-- PREREQUISITES — MUST HAPPEN FIRST (Stage C). Applying this before them breaks
--   online sync (offline sales still record locally, they just will not sync):
--     1. Every existing user is provisioned as a Supabase Auth user (auth.users)
--        via the Admin API, with a public.profiles row (role copied from
--        public.users) and public.tenant_memberships rows linking auth.uid() to
--        their existing tenant(s). user_tenant_ids()/is_tenant_member()/
--        is_tenant_owner()/is_super_admin() resolve against these — without them
--        every policy evaluates false and no data is reachable.
--     2. The POS client authenticates with Supabase Auth and sends the JWT.
--     3. New-shop signup (tenants INSERT) is moved to a server-side SECURITY
--        DEFINER RPC or Admin API call — see §8. It is NOT granted to clients.
--
-- WHAT THIS DOES NOT DO
--   • It does not create auth.users rows — SQL cannot; that is the Admin API.
--   • It does not re-enable anon anywhere.
--   • It does not drop the columns password/pin — only NULLs their values. A
--     later, separate migration may DROP the columns once Stage C is verified.
--
-- ROLLBACK / RECOVERY (deliberately NOT "restore anon"):
--   Restoring unrestricted anonymous access is not an acceptable rollback. Take
--   a full logical backup immediately before applying. On failure: restore that
--   backup (returning to the pre-migration state) OR roll FORWARD by re-running
--   account provisioning. The permissive migration stays in git for forensics
--   only, never as a production revert path. See docs/SECURITY.md.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Scrub plaintext credentials out of public.users (secrets only)
-- -----------------------------------------------------------------------------
-- Safe: the app no longer reads password/pin (REMOTE_USER_COLUMNS excludes them,
-- userRow() never mirrors them). No shop, product, sale, stock, customer,
-- expense or receipt data is touched.
UPDATE public.users SET password = NULL, pin = NULL
  WHERE password IS NOT NULL OR pin IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Drop the permissive anon policies from 20261024000002
-- -----------------------------------------------------------------------------
-- These are the actual vulnerability: `FOR ALL TO anon USING (true)`.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tenants', 'branches', 'registers', 'users', 'products',
    'product_categories', 'customers', 'sales', 'sale_items',
    'expenses', 'inventory_movements', 'audit_logs'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "Local-first sync: anon %s" ON public.%I',
      tbl, tbl
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Revoke every grant the anon role holds on the public schema
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE USAGE ON SCHEMA public FROM anon;
-- Future tables/sequences must not silently inherit anon access either.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- -----------------------------------------------------------------------------
-- 4. Grant the authenticated role the access the policies will govern
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO authenticated;
-- NOTE: table-level GRANT is necessary but NOT sufficient. RLS still decides
-- row access, and for tables with no authenticated policy the result is DENY.
-- The grants below are deliberately broad; the policies in §5/§6 are narrow.

-- -----------------------------------------------------------------------------
-- 5. Tables that already have CORRECT authenticated policies — LEAVE THEM ALONE
-- -----------------------------------------------------------------------------
--  products, sales        : "Tenant isolation for …" FOR ALL (initial_schema).
--  sale_items             : "Tenant isolation for sale_items" scoped by
--                           sale_id -> sales -> tenant_id (initial_schema) —
--                           this is the CORRECT scope; v1's tenant_id rewrite
--                           was the fatal defect. Nothing to change.
--  product_categories     : member SELECT + OWNER INSERT/UPDATE, NO DELETE
--                           (stock_book). Correct. Do NOT widen.
--  inventory_movements    : member SELECT + OWNER INSERT, NO UPDATE/DELETE
--                           (stock_book, append-only ledger). Correct. Do NOT
--                           widen. (The `apply_stock_movement` RPC that used to
--                           write here is now dead code — the app mirrors rows
--                           directly via syncMovement, still gated by the same
--                           INSERT policy + the client-side canAdjustStock().)
--  tenants (SELECT)       : "Tenant isolation for tenants select" (initial_schema).
--  profiles               : own-row SELECT/UPDATE (initial_schema) + §7 trigger.
-- No authenticated policy exists for: registers, cash_register_shifts, payments,
-- product_units, subscription_plans, subscriptions — and the app does NOT touch
-- them remotely, so they remain LOCKED (deny-all) after anon is revoked. That is
-- intentional and safe. Do not add policies for them here.

-- -----------------------------------------------------------------------------
-- 6. Add policies ONLY for the remote-written tables that have none yet
-- -----------------------------------------------------------------------------
-- Scoping matches the app's own role gates (src/lib/permissions.ts and the
-- DatabaseService methods), so RLS and the UI agree:
--   • users       : owner manages staff; members read their own shop roster.
--   • branches    : member read, owner write.
--   • customers   : member read/create/update (cashiers create customers at the
--                   till). No DELETE policy — the app never deletes customers.
--   • expenses    : member read/create, owner update.
--   • audit_logs  : append-only; any member appends, owner/super reads.

-- 6a. users: reads by members, writes by owners (or super admin).
DROP POLICY IF EXISTS "Members read own shop users" ON public.users;
CREATE POLICY "Members read own shop users" ON public.users
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Owners manage shop users" ON public.users;
CREATE POLICY "Owners manage shop users" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_owner(tenant_id));
DROP POLICY IF EXISTS "Owners update shop users" ON public.users;
CREATE POLICY "Owners update shop users" ON public.users
  FOR UPDATE TO authenticated
  USING (public.is_tenant_owner(tenant_id))
  WITH CHECK (public.is_tenant_owner(tenant_id));
DROP POLICY IF EXISTS "Owners delete shop users" ON public.users;
CREATE POLICY "Owners delete shop users" ON public.users
  FOR DELETE TO authenticated
  USING (public.is_tenant_owner(tenant_id));
-- A super_admin's own row has tenant_id NULL; is_tenant_member(NULL) and
-- is_tenant_owner(NULL) are both false for ordinary members, so NULL-tenant
-- (platform) rows stay invisible to tenants. is_tenant_owner() short-circuits
-- to true for is_super_admin(), so only a super admin manages those.

-- 6b. branches: member read, owner write.
DROP POLICY IF EXISTS "Members read branches" ON public.branches;
CREATE POLICY "Members read branches" ON public.branches
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "Owners write branches" ON public.branches;
CREATE POLICY "Owners write branches" ON public.branches
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_owner(tenant_id));
DROP POLICY IF EXISTS "Owners update branches" ON public.branches;
CREATE POLICY "Owners update branches" ON public.branches
  FOR UPDATE TO authenticated
  USING (public.is_tenant_owner(tenant_id))
  WITH CHECK (public.is_tenant_owner(tenant_id));
DROP POLICY IF EXISTS "Owners delete branches" ON public.branches;
CREATE POLICY "Owners delete branches" ON public.branches
  FOR DELETE TO authenticated
  USING (public.is_tenant_owner(tenant_id));

-- 6c. customers: member read/create/update, no delete.
DROP POLICY IF EXISTS "Members read customers" ON public.customers;
CREATE POLICY "Members read customers" ON public.customers
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "Members create customers" ON public.customers;
CREATE POLICY "Members create customers" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "Members update customers" ON public.customers;
CREATE POLICY "Members update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

-- 6d. expenses: member read/create, owner update.
DROP POLICY IF EXISTS "Members read expenses" ON public.expenses;
CREATE POLICY "Members read expenses" ON public.expenses
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "Members log expenses" ON public.expenses;
CREATE POLICY "Members log expenses" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "Owners update expenses" ON public.expenses;
CREATE POLICY "Owners update expenses" ON public.expenses
  FOR UPDATE TO authenticated
  USING (public.is_tenant_owner(tenant_id))
  WITH CHECK (public.is_tenant_owner(tenant_id));

-- 6e. audit_logs: append-only ledger. Any member appends; owner/super reads.
DROP POLICY IF EXISTS "Members append audit logs" ON public.audit_logs;
CREATE POLICY "Members append audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "Owners read audit logs" ON public.audit_logs;
CREATE POLICY "Owners read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_tenant_owner(tenant_id));

-- 6f. tenants: add UPDATE for the shop owner editing their own shop profile.
--     INSERT is intentionally NOT granted to clients (see §8) and DELETE is
--     super-admin-only (not granted here).
DROP POLICY IF EXISTS "Owners update own tenant" ON public.tenants;
CREATE POLICY "Owners update own tenant" ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.is_tenant_owner(id))
  WITH CHECK (public.is_tenant_owner(id));

-- -----------------------------------------------------------------------------
-- 7. Block privilege escalation at the row level (defect 3 fixed)
-- -----------------------------------------------------------------------------
-- RLS scopes WHO touches a row; it cannot constrain WHICH COLUMN. Both
-- public.users.role and public.profiles.role are writable by a member who owns
-- the row, and both are trusted (App.tsx re-syncs currentUser.role from
-- public.users; is_super_admin() reads profiles.role). These triggers make
-- 'super_admin' unwritable by anyone who is not already one.
--
-- BOUNDARY — is `auth.uid() IS NULL` adequate for provisioning?
--   The NULL pass-through exists so the trusted server path (the service-role
--   key, or a direct postgres connection during Stage C provisioning) can create
--   the first super admin. It is adequate HERE, but ONLY because this same
--   transaction revokes every anon grant (§3): to fire a BEFORE trigger you must
--   first hold a table grant AND pass RLS, and anon now holds neither — so an
--   unauthenticated caller cannot reach the trigger at all. A logged-in
--   non-super-admin has a non-NULL auth.uid() and is caught by the is_super_admin()
--   check. The NULL branch is therefore reachable only by the service role and
--   the table owner, not by anon. (Were anon grants ever restored, this
--   boundary would stop being safe — one more reason the rollback plan must
--   never re-enable anon.)
--
-- SECURITY INVOKER on purpose: is_super_admin() must evaluate as the calling
-- user, not as the function owner, or the check would be meaningless.
CREATE OR REPLACE FUNCTION public.block_super_admin_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- No auth.uid() => trusted server path (service role / provisioning DDL).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- An authenticated non-super-admin tried to grant (or keep) super_admin.
  IF NEW.role = 'super_admin' AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only an existing super admin can grant the super admin role'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_super_admin_escalation ON public.users;
CREATE TRIGGER trg_block_super_admin_escalation
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.block_super_admin_escalation();

DROP TRIGGER IF EXISTS trg_block_super_admin_escalation ON public.profiles;
CREATE TRIGGER trg_block_super_admin_escalation
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.block_super_admin_escalation();

-- -----------------------------------------------------------------------------
-- 8. Hardening the two SECURITY DEFINER helper functions
-- -----------------------------------------------------------------------------
-- is_super_admin() and user_tenant_ids() are SECURITY DEFINER and are called on
-- every policy evaluation. Pin their search_path so a caller cannot shadow
-- public tables via a temporary/earlier-schema object (search_path injection).
-- This changes no behaviour; it removes an attack surface.
ALTER FUNCTION public.is_super_admin()      SET search_path = public;
ALTER FUNCTION public.user_tenant_ids()     SET search_path = public;
ALTER FUNCTION public.is_tenant_member(UUID) SET search_path = public;
ALTER FUNCTION public.is_tenant_owner(UUID)  SET search_path = public;

-- NOTE (documented, not executed here): `tenants` INSERT for new-shop signup is
-- intentionally left ungranted to authenticated. It must be performed by a
-- server-side SECURITY DEFINER RPC or the Admin API so that a new tenant can be
-- created together with its owner's profile + membership atomically, and so no
-- client can mint an arbitrary tenant row.

COMMIT;
