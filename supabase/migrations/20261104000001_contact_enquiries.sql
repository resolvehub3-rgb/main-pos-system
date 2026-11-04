-- =============================================================================
-- SamTill POS — contact enquiries from the public landing site
-- =============================================================================
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

create table if not exists public.contact_enquiries (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  email       text,
  phone       text,
  package     text,
  message     text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  read_by     uuid references public.users(id)
);

alter table public.contact_enquiries enable row level security;

drop policy if exists "contact_enquiries_anon_insert" on public.contact_enquiries;
drop policy if exists "contact_enquiries_super_admin_select" on public.contact_enquiries;
drop policy if exists "contact_enquiries_super_admin_update" on public.contact_enquiries;

create policy "contact_enquiries_anon_insert"
  on public.contact_enquiries
  for insert
  to anon, authenticated
  with check (true);

create policy "contact_enquiries_super_admin_select"
  on public.contact_enquiries
  for select
  to authenticated
  using (public.is_super_admin());

create policy "contact_enquiries_super_admin_update"
  on public.contact_enquiries
  for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant insert on public.contact_enquiries to anon, authenticated;
grant select, update on public.contact_enquiries to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contact_enquiries'
  ) then
    alter publication supabase_realtime add table public.contact_enquiries;
  end if;
end $$;