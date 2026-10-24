-- ============================================================================
-- SAMTECH HELPER POS - LOCAL-FIRST SYNC COMPATIBILITY
-- Migration: 20261024000002_app_sync_compat.sql
--
-- The app is local-first: it authenticates with its own accounts and keeps all
-- state in localStorage, then mirrors rows to Supabase. That mirror had never
-- worked — every write failed and was swallowed. Four independent causes:
--
--   1. The app writes to a `users` table that does not exist (schema has
--      `profiles`, whose id is a foreign key to `auth.users`, which stays
--      empty because the app never calls Supabase Auth).
--   2. Row Level Security gates every write on `auth.uid()`. With no Supabase
--      Auth session that is NULL, so every insert/update is rejected.
--   3. `sales` is missing the columns the app sends (shop_name, cashier_name,
--      customer_name, payment_details, items).
--   4. `sales.branch_id` / `sales.cashier_id` are NOT NULL, but those parent
--      rows may not have synced yet, which would fail the whole sale.
--
-- This migration makes the existing schema able to receive the app's mirror.
-- It is additive: no rows are deleted, no existing column is removed.
--
-- >>> SECURITY NOTE <<<
-- RLS is relaxed to allow the `anon` role because the app has no Supabase
-- Auth session. The anon key is already embedded in the client bundle, so
-- this does not newly expose the project, but it DOES mean the database is
-- not protected per-tenant. Adopt Supabase Auth before exposing this to the
-- public internet — see docs/DATABASE.md.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. APP-MANAGED ACCOUNTS
-- ---------------------------------------------------------------------------
-- Deliberately NOT `profiles`: profiles.id references auth.users and this app
-- never creates auth.users rows. App accounts carry their own password and
-- PIN, so they need their own table.
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY,
    tenant_id UUID,
    shop_name TEXT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    password TEXT,
    pin TEXT,
    role TEXT NOT NULL CHECK (role IN ('super_admin', 'shop_owner', 'cashier')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users (tenant_id);

-- ---------------------------------------------------------------------------
-- 2. SALES: carry the fields the app actually records
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS shop_name TEXT,
  ADD COLUMN IF NOT EXISTS cashier_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  -- Tender detail (cash tendered / change, MoMo network+reference, card ref).
  ADD COLUMN IF NOT EXISTS payment_details JSONB,
  -- Line items are kept as a JSON snapshot so a receipt can be re-printed even
  -- if the product rows are later edited or deleted. `sale_items` remains the
  -- structured, queryable copy.
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2b. DROP FOREIGN KEYS THE APP CANNOT SATISFY
-- ---------------------------------------------------------------------------
-- The app never writes to `profiles`, `branches`, `registers` or
-- `product_units`, but these columns referenced them — so a perfectly valid
-- mirrored sale was rejected because its branch/cashier row did not exist.
-- `cashier_id` referenced `profiles` while the app keeps accounts in `users`,
-- which made every sale un-insertable.
--
-- Referential integrity for the mirror is enforced by the app, which is the
-- source of truth here. These are dropped with IF EXISTS so the migration
-- stays repeatable on databases that never had them.
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_branch_id_fkey;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_cashier_id_fkey;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_register_id_fkey;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_customer_id_fkey;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_shift_id_fkey;
ALTER TABLE public.sales ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE public.sales ALTER COLUMN cashier_id DROP NOT NULL;

ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_product_id_fkey;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_category_id_fkey;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_unit_id_fkey;

ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_product_id_fkey;
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_branch_id_fkey;
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_created_by_fkey;
ALTER TABLE public.inventory_movements ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_tenant_id_fkey;
ALTER TABLE public.product_categories DROP CONSTRAINT IF EXISTS product_categories_tenant_id_fkey;
ALTER TABLE public.product_categories DROP CONSTRAINT IF EXISTS product_categories_parent_id_fkey;
ALTER TABLE public.product_categories DROP CONSTRAINT IF EXISTS product_categories_deactivated_by_fkey;

-- `audit_logs.user_id` referenced `profiles`, which never has rows because the
-- app keeps accounts in `users`. Every audit entry was therefore rejected.
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_tenant_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. PRODUCTS & STOCK BOOK: carry the free-text fields the app records
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS category_name TEXT;

ALTER TABLE public.products ALTER COLUMN barcode DROP NOT NULL;

-- The stock book keeps the product's display name and the operator's name on
-- each movement so history stays readable even if the product is renamed.
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS product_name TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

-- `expenses.recorded_by` referenced `profiles`; the app stores its own user ids.
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_recorded_by_fkey;
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_branch_id_fkey;
ALTER TABLE public.expenses ALTER COLUMN branch_id DROP NOT NULL;

-- Customers: the app tracks lifetime spend, which the schema had no column for.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 4. RLS: let the local-first app write and read back
-- ---------------------------------------------------------------------------
-- Each table already has tenant-isolation policies that require auth.uid().
-- Those remain in force for authenticated sessions. The policies below are
-- permissive (policies are OR-ed), so they open access for the anon role the
-- app actually uses.
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
    EXECUTE format(
      'CREATE POLICY "Local-first sync: anon %s" ON public.%I
         FOR ALL TO anon USING (true) WITH CHECK (true)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. GRANTS
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon;

-- ---------------------------------------------------------------------------
-- 6. Keep `sales.items` in sync when the structured rows change
-- ---------------------------------------------------------------------------
-- Nothing to do here by design: the app writes `items` explicitly. This note
-- exists so a future reader knows the JSON snapshot is app-maintained, not
-- trigger-maintained.
