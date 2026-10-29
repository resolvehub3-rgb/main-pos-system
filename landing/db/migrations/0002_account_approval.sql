-- =============================================================================
-- SamTill commerce — schema migration 0002 (customer account approval workflow)
-- =============================================================================
--
-- STATUS: PREPARED FOR REVIEW ONLY — THIS FILE HAS NOT BEEN EXECUTED.
--         Run it on the dedicated "samtill-commerce" Supabase project AFTER
--         0001_commerce_init.sql. NEVER run it against the SamTill POS
--         Supabase project or any database that stores POS/sales/stock data.
--
-- WHAT THIS ADDS
--   A real registration → waiting-for-approval → super-admin approval →
--   notification email → dashboard-access workflow on top of the profiles
--   table created in 0001:
--
--     * profiles gains an approval_status column (pending / approved /
--       rejected). New sign-ups start 'pending' (the column default, applied
--       by the 0001 handle_new_user trigger) — an account is not usable until
--       an admin approves it.
--     * admin_users lists which auth users may approve accounts; is_admin() is
--       the single guard every admin action checks.
--     * approve_account() / reject_account() are SECURITY DEFINER RPCs that
--       verify is_admin() before touching a profile. Approving fires an AFTER
--       UPDATE trigger that emails the customer (pg_net → Resend).
--     * request_setup() records a real "request for setup" from an approved
--       customer (own row only, authenticated).
--     * profiles is added to the supabase_realtime publication so a signed-in
--       customer sees their approval flip live (RLS still restricts them to
--       their own row — see 0001 profiles_select_own).
--
-- FAIL-CLOSED POSTURE (matches 0001)
--   Every table has row-level security with no browser write policies. The
--   only browser-writable path is the request_setup() RPC (own row,
--   authenticated). Approval and admin changes go through SECURITY DEFINER
--   RPCs that re-check is_admin() on every call — nothing trusts the browser.
--
-- OPERATOR BOOTSTRAP (after provisioning, run as the service role / SQL editor)
--   1. Register the owner account on the landing site and verify its email.
--   2. Grant that account admin rights:
--        insert into public.admin_users (user_id)
--        values ('<owner auth.users uuid>');
--   3. Configure the approval email (optional — approval works without it):
--        insert into public.app_settings (key, value) values
--          ('email_provider_api_key', 're_xxxxxxxx'),
--          ('email_from',             'SamTill <no-reply@yourdomain.example>'),
--          ('site_url',               'https://your-landing-site.example');
--      Leaving email_provider_api_key out makes the trigger skip sending
--      quietly, so approval never fails because an email provider is missing.
-- =============================================================================

begin;

-- pg_net lets a trigger make an async HTTP call (the approval email) without
-- blocking the approval transaction. Available on Supabase.
create extension if not exists pg_net;


-- -----------------------------------------------------------------------------
-- 1. Enumerated type: account approval status
-- -----------------------------------------------------------------------------

create type public.approval_status as enum (
  'pending',   -- registered, awaiting a super-admin decision (the default)
  'approved',  -- super-admin approved: the customer may use their dashboard
  'rejected'   -- super-admin declined: the account stays locked
);


-- -----------------------------------------------------------------------------
-- 2. profiles — approval columns
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column approval_status   public.approval_status not null default 'pending',
  add column approved_at       timestamptz,
  add column approved_by       uuid references auth.users (id),
  add column rejected_at       timestamptz,
  add column rejection_reason  text
    check (rejection_reason is null or char_length(rejection_reason) between 1 and 500);

comment on column public.profiles.approval_status is
  'Registration gate. Defaults to pending; only an admin approval RPC moves it '
  'to approved. The account page reads this (own row via RLS) and subscribes '
  'to it over realtime so the customer sees approval the moment it happens.';

-- Any pre-existing rows (there are none on a fresh project) stay pending.
update public.profiles set approval_status = 'pending' where approval_status is null;


-- -----------------------------------------------------------------------------
-- 3. admin_users — who may approve accounts
-- -----------------------------------------------------------------------------

create table public.admin_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users (id)
);

comment on table public.admin_users is
  'Super-admin allow-list for the commerce project. The browser can neither '
  'read nor write it (RLS below). Grant the first admin via the service role '
  '(see the bootstrap notes at the top of this file).';

alter table public.admin_users enable row level security;
-- No policies: only the service role (and SECURITY DEFINER functions) touch it.


-- Single source of truth for "is the caller an admin?". SECURITY DEFINER so it
-- can read admin_users despite its deny-all RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;


-- -----------------------------------------------------------------------------
-- 4. app_settings — server-only key/value config (email provider, site URL)
-- -----------------------------------------------------------------------------

create table public.app_settings (
  key         text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  value       text not null,
  updated_at  timestamptz not null default now()
);

comment on table public.app_settings is
  'Server-only configuration read by SECURITY DEFINER functions (e.g. the '
  'approval-email trigger). Never readable from the browser (RLS below).';

alter table public.app_settings enable row level security;
-- No policies: service role + SECURITY DEFINER functions only.

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. setup_requests — an approved customer asks for onboarding help
-- -----------------------------------------------------------------------------

create table public.setup_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  message     text check (message is null or char_length(message) between 1 and 2000),
  status      text not null default 'open'
              check (status in ('open', 'in_progress', 'resolved')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.setup_requests is
  'A customer with an approved account can request onboarding/setup help. Only '
  'the request_setup() RPC writes here (own row); admins read via RPC.';

create trigger setup_requests_set_updated_at
  before update on public.setup_requests
  for each row execute function public.set_updated_at();

create index setup_requests_user_idx on public.setup_requests (user_id, created_at desc);
create index setup_requests_status_idx on public.setup_requests (status) where status = 'open';

alter table public.setup_requests enable row level security;
-- The browser neither reads nor writes this directly; both go through RPCs so
-- the approval check (approved accounts only) is enforced server-side.


-- -----------------------------------------------------------------------------
-- 6. Customer RPC: request setup (approved accounts only, own row)
-- -----------------------------------------------------------------------------

create or replace function public.request_setup(p_message text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status public.approval_status;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select approval_status into v_status from public.profiles where id = v_uid;
  if v_status is distinct from 'approved' then
    raise exception 'account_not_approved' using errcode = '42501';
  end if;

  insert into public.setup_requests (user_id, message)
  values (v_uid, nullif(trim(coalesce(p_message, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.request_setup(text) is
  'Records a setup request from the signed-in, approved customer. Raises '
  'account_not_approved for pending/rejected accounts so the gate is enforced '
  'server-side, never just in the browser.';

revoke execute on function public.request_setup(text) from public, anon;
grant  execute on function public.request_setup(text) to authenticated;

create or replace function public.has_open_setup_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.setup_requests
    where user_id = (select auth.uid()) and status = 'open'
  );
$$;

revoke execute on function public.has_open_setup_request() from public, anon;
grant  execute on function public.has_open_setup_request() to authenticated;


-- -----------------------------------------------------------------------------
-- 7. Admin RPCs (every one re-checks is_admin() server-side)
-- -----------------------------------------------------------------------------

-- Does the caller hold admin rights? Lets the frontend show/hide the admin
-- screen without guessing.
create or replace function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin();
$$;

revoke execute on function public.am_i_admin() from public, anon;
grant  execute on function public.am_i_admin() to authenticated;


-- List accounts for the admin dashboard, newest first. Optional status filter.
create or replace function public.admin_list_accounts(
  p_status public.approval_status default null
)
returns table (
  id              uuid,
  email           text,
  full_name       text,
  approval_status public.approval_status,
  created_at      timestamptz,
  approved_at     timestamptz,
  rejection_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  return query
    select p.id, p.email, p.full_name, p.approval_status,
           p.created_at, p.approved_at, p.rejection_reason
    from public.profiles p
    where (p_status is null or p.approval_status = p_status)
    order by p.created_at desc;
end;
$$;

revoke execute on function public.admin_list_accounts(public.approval_status) from public, anon;
grant  execute on function public.admin_list_accounts(public.approval_status) to authenticated;


-- Approve an account. SECURITY DEFINER + is_admin() guard. The AFTER UPDATE
-- trigger on profiles sends the approval email.
create or replace function public.approve_account(p_user_id uuid)
returns public.approval_status
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status public.approval_status;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  update public.profiles
     set approval_status = 'approved',
         approved_at     = now(),
         approved_by     = (select auth.uid()),
         rejected_at     = null,
         rejection_reason = null
   where id = p_user_id
   returning approval_status into v_status;

  if v_status is null then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  return v_status;
end;
$$;

revoke execute on function public.approve_account(uuid) from public, anon;
grant  execute on function public.approve_account(uuid) to authenticated;


-- Reject an account with an optional reason.
create or replace function public.reject_account(
  p_user_id uuid,
  p_reason  text default null
)
returns public.approval_status
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status public.approval_status;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  update public.profiles
     set approval_status  = 'rejected',
         rejected_at      = now(),
         rejection_reason = nullif(trim(coalesce(p_reason, '')), ''),
         approved_at      = null,
         approved_by      = null
   where id = p_user_id
   returning approval_status into v_status;

  if v_status is null then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  return v_status;
end;
$$;

revoke execute on function public.reject_account(uuid, text) from public, anon;
grant  execute on function public.reject_account(uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 8. Approval email trigger (pg_net → Resend), fired on approval only
-- -----------------------------------------------------------------------------

create or replace function public.send_approval_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  api_key   text;
  from_addr text;
  site_url  text;
  display   text;
  payload   jsonb;
begin
  -- Fire only on a real transition INTO 'approved'.
  if new.approval_status = 'approved'
     and old.approval_status is distinct from 'approved' then

    select value into api_key   from public.app_settings where key = 'email_provider_api_key';
    select value into from_addr from public.app_settings where key = 'email_from';
    select value into site_url  from public.app_settings where key = 'site_url';

    -- No provider configured: skip quietly. Approval must never fail because
    -- an email provider is missing (documented fail-closed behaviour).
    if api_key is null or from_addr is null then
      return new;
    end if;

    display := coalesce(nullif(trim(new.full_name), ''), split_part(new.email, '@', 1));

    payload := jsonb_build_object(
      'from',    from_addr,
      'to',      jsonb_build_array(new.email),
      'subject', 'Your SamTill account is approved',
      'html',    '<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#102A4C">'
                 || '<h2 style="margin:0 0 12px">Welcome to SamTill, '
                 || replace(display, '<', '&lt;') || '</h2>'
                 || '<p style="margin:0 0 12px">Your SamTill account has been approved. '
                 || 'You can now sign in to your dashboard and request setup help.</p>'
                 || case when site_url is null then ''
                     else '<p style="margin:0 0 12px"><a href="' || site_url
                          || '/#/login" style="background:#B45309;color:#fff;padding:10px 18px;'
                          || 'border-radius:9999px;text-decoration:none;font-weight:bold">'
                          || 'Sign in to your dashboard</a></p>'
                   end
                 || '<p style="margin:16px 0 0;color:#64748B;font-size:13px">'
                 || 'If you did not create this account, you can ignore this email.</p>'
                 || '</div>'
    );

    -- Async: pg_net returns a request id immediately and never blocks approval.
    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || api_key,
                   'Content-Type',  'application/json'
                 ),
      body    := payload
    );

    -- Leave a trace in the audit trail (never stores the API key).
    insert into public.audit_logs (actor_user_id, actor_system, action, entity, entity_id, metadata)
    values ((select auth.uid()), 'service_role', 'account_approved', 'profile',
            new.id::text, jsonb_build_object('email_sent', api_key is not null));
  end if;

  return new;
end;
$$;

create trigger profiles_approval_email
  after update on public.profiles
  for each row execute function public.send_approval_email();


-- -----------------------------------------------------------------------------
-- 9. Realtime — a signed-in customer sees their approval flip live
-- -----------------------------------------------------------------------------

-- RLS still applies to realtime deliveries: a subscriber only receives changes
-- to rows they can SELECT (their own profile, per profiles_select_own).
alter publication supabase_realtime add table public.profiles;


-- =============================================================================
-- End of migration 0002.
--
-- To go live (owner):
--   1. Run 0001 then this file on the dedicated samtill-commerce project.
--   2. Promote the owner account (bootstrap insert into admin_users).
--   3. Optionally insert the email settings into app_settings.
--   4. Set the landing site's VITE_COMMERCE_SUPABASE_URL /
--      VITE_COMMERCE_SUPABASE_ANON_KEY and flip COMMERCE.accountEnabled on.
-- The customer journey then works end to end and in realtime:
--   register → verify email → sign in → "waiting for approval" →
--   admin approves (email sent) → dashboard unlocks live.
-- =============================================================================
