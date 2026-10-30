-- ---------------------------------------------------------------------------
-- MIGRATION 6: the owner-edited store profile needs a receipt footer column
--
-- "Supermarket Store Settings" lets the shop owner set the legal name, the
-- address and phone printed on receipts, and the receipt footer note. The
-- first three already had columns on `tenants`; the footer note had nowhere to
-- live, so its textarea was a `defaultValue` that the Save button toasted over
-- and nothing ever persisted — least of all to an open till.
--
-- `receipt_footer` closes that gap:
--
--   NULL  — never edited. The app prints its built-in default note.
--   ''    — the owner cleared the note on purpose. No footer line is printed.
--   text  — exactly what the owner typed.
--
-- Nothing else has to be arranged for this to be live:
--
--   * writes ride the "Owners update own tenant" policy from
--     20261029000001 §6f, the same one that already guards the name/address/
--     phone columns;
--   * `public.tenants` is already a member of the `supabase_realtime`
--     publication (20261030000002), so an UPDATE broadcasts to every session
--     subscribed to that table — which is how an edit lands on open cashier
--     tills without a reload.
--
-- Idempotent, so it is safe to run on a project that already has the column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS receipt_footer TEXT;

COMMENT ON COLUMN public.tenants.receipt_footer IS
  'Owner-edited note printed at the foot of every receipt. NULL = never edited (app default), empty string = cleared on purpose.';
