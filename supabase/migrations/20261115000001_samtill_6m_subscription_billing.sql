-- =============================================================================
-- Migration: 20261115000001_samtill_6m_subscription_billing.sql
-- Description: Reconciles the SamTill POS Supabase schema with the single
--              GH₵500.00 6-Month Subscription model and Paystack backend
--              verification pipeline (plans, orders, entitlements,
--              subscriptions, webhook_events, tenant billing fields).
--
-- SAFETY / IDEMPOTENCY:
--   - Safe to run on an existing SamTill POS project that already ran
--     20261020000001_initial_schema.sql .. 20261030000002_realtime_tenants.sql.
--   - Browser clients (anon / authenticated) can NEVER insert/update/delete
--     orders, plans, entitlements, webhook_events, or subscription dates.
--   - Backend Vercel API routes verify Paystack transactions/webhooks with the
--     service-role key and update entitlements, subscriptions, and tenants.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Enumerated types (create only if missing)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'order_status'
  ) THEN
    CREATE TYPE public.order_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'entitlement_status'
  ) THEN
    CREATE TYPE public.entitlement_status AS ENUM ('active', 'expired', 'revoked');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Extend public.tenants with 6-month subscription tracking fields
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_plan_code TEXT,
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_reference TEXT;

-- -----------------------------------------------------------------------------
-- 3. public.plans — server source of truth for subscription price & duration
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  code                TEXT PRIMARY KEY
                      CHECK (code ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description         TEXT,
  amount_minor        BIGINT NOT NULL CHECK (amount_minor > 0),
  currency            TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = 'GHS'),
  billing_type        TEXT NOT NULL DEFAULT 'one_time'
                      CHECK (billing_type IN ('one_time', 'recurring')),
  interval_months     INT NOT NULL CHECK (interval_months BETWEEN 1 AND 60),
  entitlement_product TEXT NOT NULL DEFAULT 'samtill-pos',
  paystack_plan_code  TEXT UNIQUE,
  active              BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

DROP TRIGGER IF EXISTS plans_set_updated_at ON public.plans;
CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Public marketing / logged-in checkout reads go through /api/plans; allow
-- read-only SELECT of active plans if needed, never client writes.
DROP POLICY IF EXISTS "plans_select_active" ON public.plans;
CREATE POLICY "plans_select_active"
  ON public.plans
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- Seed ONLY the single GH₵500.00 6-Month Subscription package and deactivate any legacy tiers.
UPDATE public.plans
   SET active = false
 WHERE code IN ('starter', 'business', 'professional');

INSERT INTO public.plans (
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
)
VALUES (
  'samtill-pos-6m',
  'SamTill POS — 6-Month Subscription',
  'Single upfront payment granting access to the SamTill POS system for 6 calendar months from payment verification.',
  50000,
  'GHS',
  'one_time',
  6,
  'samtill-pos',
  NULL,
  true
)
ON CONFLICT (code) DO UPDATE SET
  name                = EXCLUDED.name,
  description         = EXCLUDED.description,
  amount_minor        = EXCLUDED.amount_minor,
  currency            = EXCLUDED.currency,
  billing_type        = EXCLUDED.billing_type,
  interval_months     = EXCLUDED.interval_months,
  entitlement_product = EXCLUDED.entitlement_product,
  paystack_plan_code  = EXCLUDED.paystack_plan_code,
  active              = EXCLUDED.active;

-- -----------------------------------------------------------------------------
-- 4. public.orders — Paystack payment references & verified transactions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id                  UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  plan_code                  TEXT NOT NULL REFERENCES public.plans(code),
  amount_minor               BIGINT NOT NULL CHECK (amount_minor > 0),
  currency                   TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = 'GHS'),
  reference                  TEXT NOT NULL UNIQUE
                             CHECK (reference ~ '^[A-Za-z0-9_-]{8,64}$'),
  status                     public.order_status NOT NULL DEFAULT 'pending',
  paystack_customer_code     TEXT,
  paystack_transaction_id    BIGINT UNIQUE,
  paystack_authorization_url TEXT,
  paid_at                    TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT orders_paid_requires_timestamp CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS orders_set_updated_at ON public.orders;
CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS orders_user_created_idx ON public.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_tenant_created_idx ON public.orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders (status) WHERE status = 'pending';

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select_own_or_tenant" ON public.orders;
CREATE POLICY "orders_select_own_or_tenant"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (tenant_id IS NOT NULL AND tenant_id IN (SELECT tenant_id FROM public.user_tenant_ids()))
    OR public.is_super_admin()
  );

-- -----------------------------------------------------------------------------
-- 5. Reconcile public.subscriptions with billing lifecycle columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ALTER COLUMN tenant_id DROP NOT NULL,
  ALTER COLUMN plan_id DROP NOT NULL;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS plan_code TEXT REFERENCES public.plans(code),
  ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT,
  ADD COLUMN IF NOT EXISTS channel TEXT,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- Replace narrow CHECK constraints from 20261020000001_initial_schema.sql safely.
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trial', 'past_due', 'suspended', 'cancelled', 'attention', 'non_renewing', 'completed'));

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_interval_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_billing_interval_check
  CHECK (billing_interval IN ('monthly', 'yearly', 'one_time'));

ALTER TABLE public.subscriptions
  ALTER COLUMN billing_interval SET DEFAULT 'one_time',
  ALTER COLUMN current_period_end DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_paystack_code_uidx
  ON public.subscriptions (paystack_subscription_code)
  WHERE paystack_subscription_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_user_created_idx
  ON public.subscriptions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS subscriptions_tenant_created_idx
  ON public.subscriptions (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select_own_or_tenant" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own_or_tenant"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (tenant_id IS NOT NULL AND tenant_id IN (SELECT tenant_id FROM public.user_tenant_ids()))
    OR public.is_super_admin()
  );

-- -----------------------------------------------------------------------------
-- 6. public.entitlements — active access windows (6 calendar months per charge)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entitlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id       UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  product_code    TEXT NOT NULL DEFAULT 'samtill-pos',
  plan_code       TEXT REFERENCES public.plans(code),
  source_order_id UUID REFERENCES public.orders(id),
  status          public.entitlement_status NOT NULL DEFAULT 'active',
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  valid_to        TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT entitlements_period_order CHECK (valid_to > valid_from)
);

ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS entitlements_set_updated_at ON public.entitlements;
CREATE TRIGGER entitlements_set_updated_at
  BEFORE UPDATE ON public.entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS entitlements_user_product_idx
  ON public.entitlements (user_id, product_code, status);
CREATE INDEX IF NOT EXISTS entitlements_tenant_product_idx
  ON public.entitlements (tenant_id, product_code, status);

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entitlements_select_own_or_tenant" ON public.entitlements;
CREATE POLICY "entitlements_select_own_or_tenant"
  ON public.entitlements
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (tenant_id IS NOT NULL AND tenant_id IN (SELECT tenant_id FROM public.user_tenant_ids()))
    OR public.is_super_admin()
  );

-- -----------------------------------------------------------------------------
-- 7. public.webhook_events — idempotent Paystack webhook + verify ledger
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key        TEXT NOT NULL UNIQUE,
  event_type        TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('paystack_webhook', 'transaction_verify')),
  status            TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'processed', 'failed')),
  payload           JSONB NOT NULL,
  failure_reason    TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  processed_at      TIMESTAMPTZ,
  payload_purged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS webhook_events_type_received_idx
  ON public.webhook_events (event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_status_idx
  ON public.webhook_events (status) WHERE status = 'failed';

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- Service role only; no client policies.

-- -----------------------------------------------------------------------------
-- 8. Extend public.audit_logs so backend billing audit entries insert cleanly
-- -----------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_user_id UUID,
  ADD COLUMN IF NOT EXISTS actor_system TEXT DEFAULT 'service_role',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ip_hash TEXT;

CREATE INDEX IF NOT EXISTS audit_logs_actor_user_idx
  ON public.audit_logs (actor_user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 9. Ensure safe minimal privileges (read-only on billing tables for authenticated)
-- -----------------------------------------------------------------------------
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT ON public.orders, public.subscriptions, public.entitlements TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.plans, public.orders, public.subscriptions, public.entitlements, public.webhook_events FROM anon, authenticated;

COMMIT;
