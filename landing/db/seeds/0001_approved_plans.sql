-- =============================================================================
-- 0001 — APPROVED SUBSCRIPTION PLAN (Single 6-Month Plan)
-- =============================================================================
--
-- Run this against the dedicated COMMERCE Supabase project ONLY, after
-- migrations/0001_commerce_init.sql, and never against the POS project.
--
-- Approved commercial model (matches landing/src/config/pricing.ts):
--
--   samtill-pos-6m   GH₵500.00 (50000 pesewas)   one_time   6 calendar months
--
-- Rules encoded below:
--   * amounts are MINOR units (pesewas) — GH₵500.00 = 50000;
--   * billing_type = 'one_time' — single upfront payment, no monthly billing;
--   * interval_months = 6 — activates a 6-month subscription and entitlement
--     from successful server-side payment verification;
--   * legacy tier rows ('starter', 'business', 'professional') are marked
--     inactive so they can never be queried or purchased again.
-- =============================================================================

update public.plans
   set active = false
 where code in ('starter', 'business', 'professional');

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
    'samtill-pos-6m',
    'SamTill POS — 6-Month Subscription',
    'Full access to the SamTill POS system for six months after successful upfront payment.',
    50000,
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

-- Sanity check: exactly one active 6-month subscription plan at GH₵500.00 (50000 pesewas).
select code,
       name,
       amount_minor,
       billing_type,
       interval_months,
       active
  from public.plans
 where active = true
 order by amount_minor;
