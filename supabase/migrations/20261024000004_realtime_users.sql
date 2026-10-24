-- ---------------------------------------------------------------------------
-- MIGRATION 4: broadcast staff changes over realtime
--
-- The shop owner can now delete a cashier (and toggle them active/inactive)
-- from the Staff table. That write is local-first and pushed to Supabase, and
-- every *other* open session is meant to drop the row without a reload.
--
-- It only reaches them if `public.users` is in the `supabase_realtime`
-- publication. It never was: the publication was seeded in
-- 20261020000001 with sales, products, inventory_movements and
-- cash_register_shifts, and 20261024000001 added product_categories. Without
-- this migration the app subscribes to `users` and simply never fires — a
-- silent no-op, because Supabase reports no error for an unpublished table.
--
-- Everything else the subscriber needs is already in place:
--   * RLS on `public.users` is open to `anon` (20261024000002, section 4), and
--   * `GRANT DELETE` went to `anon` in the same migration (section 5).
--
-- REPLICA IDENTITY stays DEFAULT, which is enough: a DELETE payload carries
-- the primary key in `old`, and that is all the app needs to find the row.
--
-- Known gap, deliberately left alone here: `public.tenants` is subscribed by
-- the app but is also unpublished, so its handler never fires. Separate
-- concern from this feature — fixing it belongs in its own migration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  END IF;
END $$;
