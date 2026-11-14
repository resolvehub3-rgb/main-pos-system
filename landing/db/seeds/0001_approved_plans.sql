-- =============================================================================
-- 0001 — APPROVED PLAN ROW (Single GH₵500.00 / 6-Month Subscription)
-- =============================================================================
-- Keeps the standalone commerce seed aligned with `landing/src/config/pricing.ts`.
--   * `samtill-6m` -> 50000 minor units (GH₵500.00), 'GHS', 'one_time', 6 months
--   * Idempotent upsert so re-running updates price/status cleanly.
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
    'samtill-6m',
    '6-Month Subscription',
    'Complete SamTill POS access for 6 months with single upfront payment of GH₵500.00.',
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

update public.plans
   set active = false
 where code <> 'samtill-6m' and active = true;

select code,
       name,
       amount_minor,
       billing_type,
       interval_months,
       active
  from public.plans
 order by amount_minor;
