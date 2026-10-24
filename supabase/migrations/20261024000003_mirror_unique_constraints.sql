-- ============================================================================
-- SAMTECH HELPER POS - STOP THE MIRROR SILENTLY DROPPING ROWS
-- Migration: 20261024000003_mirror_unique_constraints.sql
--
-- The Supabase sync layer is fire-and-forget: it upserts and moves on, so any
-- rejected row is simply gone from the database with no error reaching the
-- user. Four UNIQUE constraints were stricter than the rules the app actually
-- enforces, which made them silent data-loss paths rather than useful guards:
--
--   1. users.email
--      The app enforces "one account per email" *per store* (see addUser /
--      addCashier), but every browser bootstraps the super admin from
--      VITE_SUPER_ADMIN_EMAIL with its own `user-<timestamp>` id. Opening the
--      app in a second browser, or on a second origin during development,
--      upserts the same email under a different UUID -> 409, super admin never
--      stored. This one is currently reproducing.
--
--   2. tenants.slug
--      Derived from the shop name (`ShopOwnerDashboard`, `SuperAdminDashboard`
--      both slugify the name). Two supermarkets with the same name collide,
--      so the second shop's tenant row — the head of every FK chain — was
--      dropped, taking its products and sales with it. The app never checks
--      slug uniqueness, and `slug` is only ever used to build filenames and a
--      display email domain (`@${slug}.com`), never looked up as a key.
--
--   3. sales (tenant_id, invoice_number)
--      `invoice_number` is `REC-` + the last 6 digits of Date.now(), which
--      repeats roughly every 16.7 minutes. Every collision discarded a real
--      sale from the mirror. A duplicated invoice number in a backup is far
--      less harmful than a missing sale.
--
--   4. products (tenant_id, barcode)
--      addProduct does not reject a barcode already in use in the same shop,
--      so this constraint could discard an ordinary product. Barcode lookups
--      resolve through the app, which tolerates the ambiguity.
--
-- The non-unique indexes below keep lookups on these columns fast; they simply
-- stop rejecting rows the application already considers valid.
--
-- product_categories (tenant_id, name) is deliberately LEFT UNIQUE: addCategory
-- rejects duplicates before it ever syncs, so that constraint can never reject
-- a row the app believes is valid.
--
-- >> NOTE <<  Re-run this file if you have already applied an earlier version.
-- Every statement is idempotent (IF EXISTS / IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. users.email
-- ---------------------------------------------------------------------------
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_key;
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);

-- ---------------------------------------------------------------------------
-- 2. tenants.slug
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_slug_key;
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants (slug);

-- ---------------------------------------------------------------------------
-- 3. sales (tenant_id, invoice_number)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_tenant_id_invoice_number_key;
CREATE INDEX IF NOT EXISTS idx_sales_tenant_invoice
  ON public.sales (tenant_id, invoice_number);

-- ---------------------------------------------------------------------------
-- 4. products (tenant_id, barcode)
-- ---------------------------------------------------------------------------
-- addProduct does not reject a barcode that another product in the shop
-- already uses, so this constraint could reject a perfectly ordinary product.
-- Barcode scanning resolves through the app, which tolerates the ambiguity.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_tenant_id_barcode_key;
CREATE INDEX IF NOT EXISTS idx_products_tenant_barcode
  ON public.products (tenant_id, barcode);
