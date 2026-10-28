-- =============================================================================
-- 0001 — APPROVED PLAN ROWS (one-time licence tiers)
-- =============================================================================
--
-- Run this against the dedicated COMMERCE Supabase project ONLY, immediately
-- after migrations/0001_commerce_init.sql, and never against the POS project.
--
-- Approved commercial model (see landing/src/config/pricing.ts, which is the
-- copy these prices must match):
--
--   starter       GHS   499   one-time, 1 computer, 6 months support
--   business      GHS   899   one-time, 1 computer, 6 months support
--   professional  GHS 1,499   one-time, 1 computer, 6 months support
--
-- Rules encoded below:
--   * amounts are MINOR units (pesewas) — 499 GHS = 49900;
--   * billing_type = 'one_time' — a single charge, no auto-renewal;
--   * interval_months = 6 — the access window a payment grants (the included
--     maintenance/support period). The event reducer turns this into
--     entitlement.valid_to, so a purchase grants installer downloads and
--     updates for six months;
--   * `code` MUST equal the `id` of the matching package in
--     landing/src/config/pricing.ts, or the website cannot buy that package.
--
-- Idempotent: re-running upserts the same values instead of failing.
-- =============================================================================

insert into public.plans (
  code,
  name,
  description,
  amount_minor,
  currency,
  billing_type,
  interval_months,
  entitlement_product,
  paystack_plan_code,
  active
) values
  (
    'starter',
    'Starter',
    'For a single shop that needs fast, reliable barcode checkout and clear daily sales records.',
    49900,
    'GHS',
    'one_time',
    6,
    'samtill-pos',
    null,
    true
  ),
  (
    'business',
    'Business',
    'For a growing shop that wants fuller stock control, customer records and stronger reporting.',
    89900,
    'GHS',
    'one_time',
    6,
    'samtill-pos',
    null,
    true
  ),
  (
    'professional',
    'Professional',
    'For a busy supermarket that needs the full till workflow, customer-facing display and shift control.',
    149900,
    'GHS',
    'one_time',
    6,
    'samtill-pos',
    null,
    true
  )
on conflict (code) do update set
  name                 = excluded.name,
  description          = excluded.description,
  amount_minor         = excluded.amount_minor,
  currency             = excluded.currency,
  billing_type         = excluded.billing_type,
  interval_months      = excluded.interval_months,
  entitlement_product  = excluded.entitlement_product,
  active               = excluded.active;

-- Sanity check: exactly three active plans, all one-time, all 6-month access.
select code,
       name,
       amount_minor,
       billing_type,
       interval_months,
       active
  from public.plans
 order by amount_minor;
