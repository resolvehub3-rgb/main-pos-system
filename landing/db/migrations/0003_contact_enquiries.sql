-- =============================================================================
-- SamTill commerce — schema migration 0003 (contact enquiries)
-- =============================================================================
--
-- STATUS: PREPARED FOR REVIEW ONLY — NOT EXECUTED.
-- TARGET: the dedicated samtill-commerce Supabase project only.
--
-- Stores public contact/enquiry messages submitted from the landing site's
-- contact form. Writes happen server-side via the service role (bypasses RLS);
-- anon/authenticated have no write access. Read access is service-role only.
-- =============================================================================

create table public.contact_enquiries (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  email       text,
  phone       text,
  package     text,
  message     text not null,
  ip          text,
  created_at  timestamptz not null default now()
);

alter table public.contact_enquiries enable row level security;

-- No policies: only the service role can read/write. The browser (anon /
-- authenticated) has no access at all.
revoke all on public.contact_enquiries from anon, authenticated;
grant select, insert, update, delete on public.contact_enquiries to service_role;