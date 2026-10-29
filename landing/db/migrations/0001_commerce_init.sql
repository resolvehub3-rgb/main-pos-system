-- =============================================================================
-- SamTill commerce — schema migration 0001 (customer accounts, orders,
-- subscriptions, entitlements, webhooks, audit)
-- =============================================================================
--
-- STATUS: PREPARED FOR REVIEW ONLY — THIS FILE HAS NOT BEEN EXECUTED.
--         No database anywhere has run it. It must not be executed until the
--         owner explicitly approves creating the dedicated commerce project.
--
-- TARGET: a NEW, separate Supabase project (working name "samtill-commerce").
--         NEVER run this against the SamTill POS Supabase project, and never
--         against any database that stores POS/sales/stock data. The POS
--         production database must remain completely untouched.
--
-- DESIGN PRINCIPLES
--   1. Deny by default. Every table is created with row-level security
--      enabled and only the policies documented below exist. The browser
--      (anon / authenticated roles) can read nothing except the signed-in
--      user's own profile row, and can write nothing at all.
--   2. All writes — webhook processing, checkout, entitlement changes,
--      audit records — happen server-side inside Vercel functions using the
--      service-role key (bypasses RLS). The service-role key never ships to
--      the browser.
--   3. No prices are seeded. Plan rows are inserted only after the owner
--      approves commercial terms (landing/docs/01-commercial-decisions.md).
--
-- CONVENTIONS
--   * Money: *_minor columns are integer pesewas (GH₵1.00 = 100).
--   * Timestamps: timestamptz, UTC.
--   * UUIDs: gen_random_uuid() (built into PostgreSQL 13+).
--   * This migration is intentionally a one-shot script: no if-not-exists
--     guards, so a partial/accidental re-run fails loudly instead of
--     silently skipping work.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Hardening defaults for this (dedicated) schema
-- -----------------------------------------------------------------------------
-- Supabase's default privileges grant ALL table privileges to anon and
-- authenticated. RLS would still deny access (no policies), but we tighten
-- the grants as defence in depth: the public roles get no write access to
-- any table in this schema, now or after future migrations.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

revoke insert, update, delete, truncate on all tables in schema public from authenticated;
-- Sequences accept only USAGE and SELECT; spelling out INSERT etc. here is a
-- syntax error (invalid privilege type INSERT for sequence).
revoke usage, select on all sequences in schema public from authenticated;

alter default privileges in schema public
  revoke all on tables from anon;
alter default privileges in schema public
  revoke all on sequences from anon;
alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from authenticated;
alter default privileges in schema public
  revoke usage, select on sequences from authenticated;

grant usage on schema public to anon, authenticated;
-- Read grants are further restricted by RLS (see policies below).
grant select on all tables in schema public to authenticated;


-- -----------------------------------------------------------------------------
-- 1. Enumerated types
-- -----------------------------------------------------------------------------

create type public.order_status as enum (
  'pending',   -- checkout initialised, payment not confirmed yet
  'paid',      -- verified success (server-side verify or signed webhook)
  'failed',    -- payment attempt failed
  'refunded'   -- refunded (manual admin action; refund policy undecided)
);

create type public.subscription_status as enum (
  'active',        -- in a paid period, auto-renew depending on channel
  'attention',     -- last renewal/payment failed; access continues to valid_to
  'non_renewing',  -- will not renew; access continues to period end
  'cancelled',     -- cancelled early; access continues to period end
  'completed'      -- ended by provider
);

create type public.entitlement_status as enum (
  'active',    -- access granted between valid_from and valid_to
  'expired',   -- admin/provider marked expired ahead of valid_to
  'revoked'    -- access withdrawn (refund, abuse, admin action)
);


-- -----------------------------------------------------------------------------
-- 2. Shared trigger: updated_at maintenance
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- 3. profiles — customer accounts (one row per auth.users row)
-- -----------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique
              check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name   text check (full_name is null or char_length(full_name) between 1 and 120),
  phone       text check (phone is null or phone ~ '^\+?[0-9][0-9 ]{6,19}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Customer account details. Created automatically from Supabase Auth sign-ups '
  '(trigger below). Browser may SELECT only its own row; all writes are '
  'server-side via service role.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Profile rows are created by Supabase Auth itself (security definer), so no
-- INSERT policy is needed for the browser — and none is granted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null then
    return new; -- phone-only or admin-created users: profile filled in later
  end if;

  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'full_name',
                  new.raw_user_meta_data ->> 'name', ''), 120),
    -- Optional. Stored only when it matches the profiles.phone CHECK
    -- constraint; anything else becomes NULL rather than failing the whole
    -- signup over a formatting nicety. The browser validates the same shape
    -- before submitting (src/lib/validation.ts).
    case
      when new.raw_user_meta_data ->> 'phone' is null then null
      when new.raw_user_meta_data ->> 'phone' ~ '^\+?[0-9][0-9 ]{6,19}$'
        then new.raw_user_meta_data ->> 'phone'
      else null
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: the only browser-readable row in the whole schema besides none.
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- No insert/update/delete policies: profile edits go through server code.


-- -----------------------------------------------------------------------------
-- 4. plans — server-controlled products/prices
--     APPROVED MODEL: ONE-TIME LICENCE TIERS (GHS 499 / 899 / 1,499), one
--     computer, six months of maintenance and support. `interval_months`
--     therefore means "months of access granted by a payment" — 6 — and NOT a
--     renewal period. Rows are seeded from db/seeds/0001_approved_plans.sql;
--     active = false keeps a plan invisible to checkout even once it exists.
-- -----------------------------------------------------------------------------

create table public.plans (
  code                text primary key
                      check (code ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name                text not null check (char_length(name) between 1 and 80),
  description         text,
  amount_minor        bigint not null check (amount_minor > 0),
  currency            text not null default 'GHS' check (currency = 'GHS'),
  -- 'one_time'  : a single charge that grants `interval_months` of access
  --               (the included support/updates window — 6 for every v1 tier).
  -- 'recurring' : reserved; only used if subscription billing is ever approved.
  billing_type        text not null default 'one_time'
                      check (billing_type in ('one_time', 'recurring')),
  -- Months of access a successful payment grants. Drives entitlement.valid_to
  -- in the shared event reducer (api/_lib/event-reducer.ts), so a one-time
  -- purchase of 6 grants six months of access.
  interval_months     int not null check (interval_months between 1 and 60),
  entitlement_product text not null default 'samtill-pos',
  -- Populated only if/when Paystack plan-based auto-renewal is approved.
  paystack_plan_code  text unique,
  active              boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on column public.plans.billing_type is
  'One-time licence tiers are the approved model; recurring is reserved for a '
  'future approved subscription offering.';

comment on column public.plans.interval_months is
  'For billing_type=one_time this is the months of access a payment grants '
  '(6 = the included maintenance/support window), not a renewal period.';

comment on table public.plans is
  'Source of truth for purchasable plans. The browser never sends a price: '
  'checkout resolves the plan server-side and ignores any client-supplied '
  'amount. Package ids on the website must equal plans.code.';

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

alter table public.plans enable row level security;
-- No policies: only the service role reads/writes plans (via /api functions).


-- -----------------------------------------------------------------------------
-- 5. orders — one row per checkout attempt / payment reference
-- -----------------------------------------------------------------------------

create table public.orders (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  plan_code                text not null references public.plans (code),
  amount_minor             bigint not null check (amount_minor > 0),
  currency                 text not null default 'GHS' check (currency = 'GHS'),
  -- Server-generated unique payment reference passed to Paystack.
  reference                text not null unique
                           check (reference ~ '^[A-Za-z0-9_-]{8,64}$'),
  status                   public.order_status not null default 'pending',
  paystack_customer_code   text,
  paystack_transaction_id  bigint unique,
  paystack_authorization_url text,
  paid_at                  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint orders_paid_requires_timestamp check (status <> 'paid' or paid_at is not null)
);

comment on table public.orders is
  'Payment references. status pending->paid is a one-way transition guarded '
  'server-side (UPDATE ... WHERE status = pending), which makes entitlement '
  'activation idempotent across webhook and verify paths.';

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create index orders_user_created_idx on public.orders (user_id, created_at desc);
create index orders_status_idx on public.orders (status) where status = 'pending';

alter table public.orders enable row level security;
-- No policies: orders are read/written only by server code (service role).


-- -----------------------------------------------------------------------------
-- 6. subscriptions — billing state (auto-renew where the provider supports it)
--
-- Paystack limitation (verified against official docs): automatic recurring
-- billing supports CARD payments and Nigerian direct debit only. Ghana mobile
-- money is one-time only, so MoMo customers renew manually and their rows keep
-- paystack_subscription_code = null with auto_renew = false.
-- -----------------------------------------------------------------------------

create table public.subscriptions (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users (id) on delete cascade,
  plan_code                  text not null references public.plans (code),
  paystack_subscription_code text unique,
  status                     public.subscription_status not null default 'active',
  channel                    text
                             check (channel is null or channel in
                                   ('card', 'bank', 'ussd', 'mobile_money',
                                    'bank_transfer', 'qr', 'unknown')),
  auto_renew                 boolean not null default false,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  cancel_at_period_end       boolean not null default false,
  cancelled_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint subscriptions_period_order
    check (current_period_end is null or current_period_start is null
           or current_period_end > current_period_start)
);

comment on table public.subscriptions is
  'Billing lifecycle. status=attention means a renewal charge failed: access '
  'continues until the entitlement valid_to, then access stops.';

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create index subscriptions_user_idx on public.subscriptions (user_id, created_at desc);

alter table public.subscriptions enable row level security;
-- No policies: service role only.


-- -----------------------------------------------------------------------------
-- 7. entitlements — what a customer may access, and until when
-- -----------------------------------------------------------------------------

create table public.entitlements (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  product_code    text not null default 'samtill-pos',
  plan_code       text references public.plans (code),
  source_order_id uuid references public.orders (id),
  status          public.entitlement_status not null default 'active',
  valid_from      timestamptz not null default now(),
  valid_to        timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint entitlements_period_order check (valid_to > valid_from)
);

comment on table public.entitlements is
  'Server-computed access window. Created/extended only by verified payments '
  '(transaction verify or signed Paystack webhook) — never by a frontend '
  'redirect or query parameter.';

create trigger entitlements_set_updated_at
  before update on public.entitlements
  for each row execute function public.set_updated_at();

create index entitlements_user_product_idx
  on public.entitlements (user_id, product_code, status);

alter table public.entitlements enable row level security;
-- No policies: service role only (the API returns the caller's own rows).


-- -----------------------------------------------------------------------------
-- 8. webhook_events — Paystack event ingestion + deduplication
--
-- dedupe_key is UNIQUE and is the idempotency backbone:
--   * webhook deliveries: "<event>:<provider data id>" (falls back to
--     "<event>:sha256:<raw body hash>" when the payload carries no id),
--   * server-side verification: "verify:<order reference>".
-- -----------------------------------------------------------------------------

create table public.webhook_events (
  id             uuid primary key default gen_random_uuid(),
  dedupe_key     text not null unique,
  event_type     text not null,
  source         text not null check (source in ('paystack_webhook', 'transaction_verify')),
  status         text not null default 'received'
                 check (status in ('received', 'processed', 'failed')),
  payload        jsonb not null,
  failure_reason text,
  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  -- Set when the raw payload body is purged (retention, see below).
  payload_purged_at timestamptz
);

comment on table public.webhook_events is
  'Raw provider events with deduplication. Retention: full payload 90 days '
  '(purge sets payload_purged_at and empties payload), event row 12 months. '
  'status=failed rows are re-processed when the provider retries.';

create index webhook_events_type_received_idx on public.webhook_events (event_type, received_at desc);
create index webhook_events_status_idx on public.webhook_events (status) where status = 'failed';

alter table public.webhook_events enable row level security;
-- No policies: service role only. Never expose raw payment payloads.


-- -----------------------------------------------------------------------------
-- 9. audit_logs — security-relevant actions
-- -----------------------------------------------------------------------------

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_system  text not null default 'service_role'
                check (actor_system in ('service_role', 'authenticated')),
  action        text not null check (char_length(action) between 1 and 80),
  entity        text not null check (char_length(entity) between 1 and 80),
  entity_id     text,
  metadata      jsonb not null default '{}'::jsonb,
  ip_hash       text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only security trail (checkout, verification, webhook failures). '
  'Retention: 24 months.';

create index audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

alter table public.audit_logs enable row level security;
-- No policies: service role only; never updated or deleted from the app.


-- =============================================================================
-- End of migration 0001.
--
-- Retention / cleanup (documented here, executed later by an approved job):
--
--   -- purge webhook payloads older than 90 days (keep the row for audit)
--   update public.webhook_events
--      set payload = '{}'::jsonb, payload_purged_at = now()
--    where payload_purged_at is null
--      and received_at < now() - interval '90 days';
--
--   -- delete webhook rows older than 12 months
--   delete from public.webhook_events
--    where received_at < now() - interval '12 months';
--
--   -- delete audit logs older than 24 months
--   delete from public.audit_logs
--    where created_at < now() - interval '24 months';
--
-- Backups: enable Supabase daily backups on the commerce project at launch;
-- consider PITR once revenue depends on the data. Orders/entitlements should
-- be retained 7 years for accounting (do not purge them with the jobs above).
-- =============================================================================
