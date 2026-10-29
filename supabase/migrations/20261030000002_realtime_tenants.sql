-- ---------------------------------------------------------------------------
-- MIGRATION 5: broadcast shop changes over realtime
--
-- The app subscribes to postgres_changes on `public.tenants` — that is how
-- the Super Admin Dashboard is meant to learn about a shop registered from
-- another browser (landing-site approval, the owner's phone, a second
-- admin's tab) without a reload. But a table only streams when it is a
-- member of the `supabase_realtime` publication, and `tenants` never was:
-- 20261020000001 seeded the publication with sales, products,
-- inventory_movements and cash_register_shifts, 20261024000001 added
-- product_categories, and 20261024000004 added users — which documented
-- `tenants` as a known gap to be fixed in its own migration. This is that
-- migration. Without it the subscription is a silent no-op, because
-- Supabase reports no error for an unpublished table.
--
-- Everything else the subscriber needs is already in place: the authenticated
-- role holds SELECT on `tenants` (20261029000001 §4) and RLS admits every row
-- for a super admin (`Tenant isolation for tenants select`, 20261020000001),
-- which is the session the dashboard runs under.
--
-- REPLICA IDENTITY stays DEFAULT, which is enough: INSERT and UPDATE carry
-- the full row in `new`, and a DELETE payload carries the primary key in
-- `old` — all the app needs to find the row.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tenants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tenants;
  END IF;
END $$;
