-- =============================================================================
-- SamTill POS — Unified Commerce & 6-Month Subscription Migration (GH₵500.00)
-- =============================================================================
-- IDEMPOTENT: safe to execute multiple times on the unified POS Supabase project.
-- Creates the prefixed `commerce_*` tables expected by `/api/*`, hardens RLS,
-- adds `tenants.subscription_expires_at` and `contact_enquiries.ip`, and seeds
-- the single GH₵500.00 / 6-month subscription plan (`samtill-6m`).
-- =============================================================================

-- 1. POS table compatibility columns
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contact_enquiries'
  ) THEN
    ALTER TABLE public.contact_enquiries ADD COLUMN IF NOT EXISTS ip TEXT;
  ELSE
    CREATE TABLE public.contact_enquiries (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT,
      email       TEXT,
      phone       TEXT,
      package     TEXT,
      message     TEXT NOT NULL,
      ip          TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_at     TIMESTAMPTZ,
      read_by     UUID REFERENCES auth.users(id)
    );
    ALTER TABLE public.contact_enquiries ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- 2. Enum types (idempotent guards)
DO $$
BEGIN
  CREATE TYPE public.commerce_order_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.commerce_subscription_status AS ENUM ('active', 'attention', 'non_renewing', 'cancelled', 'completed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.commerce_entitlement_status AS ENUM ('active', 'expired', 'revoked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Shared updated_at trigger helper
CREATE OR REPLACE FUNCTION public.commerce_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 4. commerce_plans
CREATE TABLE IF NOT EXISTS public.commerce_plans (
  code                TEXT PRIMARY KEY CHECK (code ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description         TEXT,
  amount_minor        BIGINT NOT NULL CHECK (amount_minor > 0),
  currency            TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = 'GHS'),
  billing_type        TEXT NOT NULL DEFAULT 'one_time' CHECK (billing_type IN ('one_time', 'recurring')),
  interval_months     INT NOT NULL CHECK (interval_months BETWEEN 1 AND 60),
  entitlement_product TEXT NOT NULL DEFAULT 'samtill-pos',
  paystack_plan_code  TEXT UNIQUE,
  active              BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS commerce_plans_set_updated_at ON public.commerce_plans;
CREATE TRIGGER commerce_plans_set_updated_at
  BEFORE UPDATE ON public.commerce_plans
  FOR EACH ROW EXECUTE FUNCTION public.commerce_set_updated_at();

ALTER TABLE public.commerce_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commerce_plans_public_read_active" ON public.commerce_plans;
CREATE POLICY "commerce_plans_public_read_active"
  ON public.commerce_plans
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- 5. commerce_orders
CREATE TABLE IF NOT EXISTS public.commerce_orders (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  plan_code                  TEXT NOT NULL REFERENCES public.commerce_plans (code),
  amount_minor               BIGINT NOT NULL CHECK (amount_minor > 0),
  currency                   TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = 'GHS'),
  reference                  TEXT NOT NULL UNIQUE CHECK (reference ~ '^[A-Za-z0-9_-]{8,64}$'),
  status                     public.commerce_order_status NOT NULL DEFAULT 'pending',
  paystack_customer_code     TEXT,
  paystack_transaction_id    BIGINT UNIQUE,
  paystack_authorization_url TEXT,
  paid_at                    TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commerce_orders_paid_requires_timestamp CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

DROP TRIGGER IF EXISTS commerce_orders_set_updated_at ON public.commerce_orders;
CREATE TRIGGER commerce_orders_set_updated_at
  BEFORE UPDATE ON public.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION public.commerce_set_updated_at();

CREATE INDEX IF NOT EXISTS commerce_orders_user_created_idx ON public.commerce_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_orders_status_idx ON public.commerce_orders (status) WHERE status = 'pending';

ALTER TABLE public.commerce_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commerce_orders_select_own" ON public.commerce_orders;
CREATE POLICY "commerce_orders_select_own"
  ON public.commerce_orders
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 6. commerce_subscriptions
CREATE TABLE IF NOT EXISTS public.commerce_subscriptions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  plan_code                  TEXT NOT NULL REFERENCES public.commerce_plans (code),
  paystack_subscription_code TEXT UNIQUE,
  status                     public.commerce_subscription_status NOT NULL DEFAULT 'active',
  channel                    TEXT CHECK (channel IS NULL OR channel IN ('card', 'bank', 'ussd', 'mobile_money', 'bank_transfer', 'qr', 'unknown')),
  auto_renew                 BOOLEAN NOT NULL DEFAULT false,
  current_period_start       TIMESTAMPTZ,
  current_period_end         TIMESTAMPTZ,
  cancel_at_period_end       BOOLEAN NOT NULL DEFAULT false,
  cancelled_at               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commerce_subscriptions_period_order
    CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start)
);

DROP TRIGGER IF EXISTS commerce_subscriptions_set_updated_at ON public.commerce_subscriptions;
CREATE TRIGGER commerce_subscriptions_set_updated_at
  BEFORE UPDATE ON public.commerce_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.commerce_set_updated_at();

CREATE INDEX IF NOT EXISTS commerce_subscriptions_user_idx ON public.commerce_subscriptions (user_id, created_at DESC);

ALTER TABLE public.commerce_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commerce_subscriptions_select_own" ON public.commerce_subscriptions;
CREATE POLICY "commerce_subscriptions_select_own"
  ON public.commerce_subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 7. commerce_entitlements
CREATE TABLE IF NOT EXISTS public.commerce_entitlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  product_code    TEXT NOT NULL DEFAULT 'samtill-pos',
  plan_code       TEXT REFERENCES public.commerce_plans (code),
  source_order_id UUID REFERENCES public.commerce_orders (id),
  status          public.commerce_entitlement_status NOT NULL DEFAULT 'active',
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commerce_entitlements_period_order CHECK (valid_to > valid_from)
);

DROP TRIGGER IF EXISTS commerce_entitlements_set_updated_at ON public.commerce_entitlements;
CREATE TRIGGER commerce_entitlements_set_updated_at
  BEFORE UPDATE ON public.commerce_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.commerce_set_updated_at();

CREATE INDEX IF NOT EXISTS commerce_entitlements_user_product_idx
  ON public.commerce_entitlements (user_id, product_code, status);

ALTER TABLE public.commerce_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commerce_entitlements_select_own" ON public.commerce_entitlements;
CREATE POLICY "commerce_entitlements_select_own"
  ON public.commerce_entitlements
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 8. commerce_webhook_events (service-role only)
CREATE TABLE IF NOT EXISTS public.commerce_webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key        TEXT NOT NULL UNIQUE,
  event_type        TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('paystack_webhook', 'transaction_verify')),
  status            TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
  payload           JSONB NOT NULL,
  failure_reason    TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  payload_purged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS commerce_webhook_events_type_received_idx
  ON public.commerce_webhook_events (event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS commerce_webhook_events_status_idx
  ON public.commerce_webhook_events (status) WHERE status = 'failed';

ALTER TABLE public.commerce_webhook_events ENABLE ROW LEVEL SECURITY;

-- 9. commerce_audit_logs (service-role only)
CREATE TABLE IF NOT EXISTS public.commerce_audit_logs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID,
  actor_system  TEXT NOT NULL DEFAULT 'service_role' CHECK (actor_system IN ('service_role', 'authenticated')),
  action        TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  entity        TEXT NOT NULL CHECK (char_length(entity) BETWEEN 1 AND 80),
  entity_id     TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash       TEXT CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commerce_audit_logs_actor_idx
  ON public.commerce_audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_audit_logs_action_idx
  ON public.commerce_audit_logs (action, created_at DESC);

ALTER TABLE public.commerce_audit_logs ENABLE ROW LEVEL SECURITY;

-- 10. Least-privilege table grants (writes go through service_role API only)
REVOKE ALL ON public.commerce_plans, public.commerce_orders, public.commerce_subscriptions,
  public.commerce_entitlements, public.commerce_webhook_events, public.commerce_audit_logs
  FROM anon, authenticated;

GRANT SELECT ON public.commerce_plans TO anon, authenticated;
GRANT SELECT ON public.commerce_orders, public.commerce_subscriptions, public.commerce_entitlements TO authenticated;

-- 11. Seed the single approved GH₵500.00 / 6-month plan
INSERT INTO public.commerce_plans (
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
) VALUES (
  'samtill-6m',
  '6-Month Subscription',
  'Full access to SamTill POS (barcode checkout, Stock Book, receipt printing, staff accounts & analytics) for 6 months.',
  50000,
  'GHS',
  'one_time',
  6,
  'samtill-pos',
  NULL,
  true
)
ON CONFLICT (code) DO UPDATE SET
  name                = excluded.name,
  description         = excluded.description,
  amount_minor        = excluded.amount_minor,
  currency            = excluded.currency,
  billing_type        = excluded.billing_type,
  interval_months     = excluded.interval_months,
  entitlement_product = excluded.entitlement_product,
  active              = excluded.active;

UPDATE public.commerce_plans
   SET active = false
 WHERE code <> 'samtill-6m' AND active = true;
