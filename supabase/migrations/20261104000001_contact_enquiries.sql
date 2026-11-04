-- =============================================================================
-- SamTill POS — contact enquiries from the public landing site
-- =============================================================================
--
-- Stores messages submitted through the landing site's contact form so the
-- super-admin can review and respond to them in real time. Writes come from
-- the landing site (anon role, RLS allows insert only); reads/updates are
-- restricted to super-admins. The table is added to the realtime publication
-- so the super-admin dashboard updates live.
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

-- Anyone (anon) may submit an enquiry. No other write access.
create policy "contact_enquiries_anon_insert"
  on public.contact_enquiries
  for insert
  to anon, authenticated
  with check (true);

-- Only super-admins may read enquiries.
create policy "contact_enquiries_super_admin_select"
  on public.contact_enquiries
  for select
  to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'super_admin')
  );

-- Only super-admins may mark enquiries as read.
create policy "contact_enquiries_super_admin_update"
  on public.contact_enquiries
  for update
  to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'super_admin')
  )
  with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'super_admin')
  );

-- Realtime: publish inserts/updates so the super-admin dashboard updates live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contact_enquiries'
  ) then
    alter publication supabase_realtime add table public.contact_enquiries;
  end if;
end $$;