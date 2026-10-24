-- ============================================================================
-- SAMTECH HELPER POS - STOCK BOOK, MOVEMENT LEDGER & SHOP-MANAGED CATEGORIES
-- Migration: 20261024000001_stock_book_and_categories.sql
--
-- Incremental, repeatable, data-preserving enhancements:
--   1. product_categories: subcategories, safe deactivation, audit columns
--   2. products: weighted-average cost column (backfilled from cost_price)
--   3. inventory_movements: unit cost, running balance, references, reversals
--      + widened movement-type constraint (append-only: no UPDATE/DELETE)
--   4. RLS policies enforcing shop-owner-only category management and
--      tenant isolation (cashiers cannot manage or value stock)
--   5. apply_stock_movement() RPC — atomic row-locked stock updates that
--      cannot produce incorrect balances under concurrency
--   6. Realtime publication for product_categories
--
-- Existing records are preserved. No data is deleted or fabricated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PRODUCT CATEGORIES: subcategories + safe deactivation + audit trail
-- ---------------------------------------------------------------------------
ALTER TABLE public.product_categories
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- ---------------------------------------------------------------------------
-- 2. PRODUCTS: weighted-average cost (backfill from existing cost basis)
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(12, 4);

-- Backfill only where the mapping is reliable: use the existing cost_price
-- as the initial weighted-average cost. Existing cost history is untouched.
UPDATE public.products SET avg_cost = cost_price WHERE avg_cost IS NULL;

-- ---------------------------------------------------------------------------
-- 3. INVENTORY MOVEMENTS: full ledger columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS balance_after INT,
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES public.inventory_movements(id);

-- Widen the movement type constraint to cover the full ledger vocabulary.
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_type_check;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_type_check CHECK (type IN (
    'opening_stock',    -- initial / opening balances
    'sale',             -- POS checkout (stock out)
    'restock',          -- supplier receipt (stock in)
    'customer_return',  -- customer returns goods (stock in)
    'supplier_return',  -- goods returned to supplier (stock out)
    'damage',           -- damaged write-off (stock out)
    'expired',          -- expired write-off (stock out)
    'adjustment',       -- stock-count correction (signed quantity)
    'transfer_in',      -- branch transfer in
    'transfer_out',     -- branch transfer out
    'refund',           -- sale refund restocking (stock in)
    'reversal'          -- authorized correction of a prior movement (signed)
  ));

-- ---------------------------------------------------------------------------
-- 4. HELPER FUNCTIONS for role checks used by RLS policies
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_tenant_owner(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF public.is_super_admin() THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.user_id = auth.uid()
      AND tm.tenant_id = p_tenant_id
      AND tm.role = 'shop_owner'
      AND tm.is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF public.is_super_admin() THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.user_id = auth.uid()
      AND tm.tenant_id = p_tenant_id
      AND tm.is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ---------------------------------------------------------------------------
-- 5. RLS POLICIES
-- ---------------------------------------------------------------------------

-- Product categories: readable by shop staff; managed by shop owners ONLY.
DROP POLICY IF EXISTS "Tenant members can view categories" ON public.product_categories;
CREATE POLICY "Tenant members can view categories" ON public.product_categories
  FOR SELECT USING (
    public.is_tenant_member(tenant_id)
  );

DROP POLICY IF EXISTS "Shop owners can create categories" ON public.product_categories;
CREATE POLICY "Shop owners can create categories" ON public.product_categories
  FOR INSERT WITH CHECK (
    public.is_tenant_owner(tenant_id)
  );

DROP POLICY IF EXISTS "Shop owners can update categories" ON public.product_categories;
CREATE POLICY "Shop owners can update categories" ON public.product_categories
  FOR UPDATE USING (
    public.is_tenant_owner(tenant_id)
  ) WITH CHECK (
    public.is_tenant_owner(tenant_id)
  );

-- NOTE: intentionally NO DELETE policy.
-- Categories are deactivated, never deleted, so product and stock history
-- (which references categories) is always preserved.

-- Inventory movements: append-only ledger.
DROP POLICY IF EXISTS "Tenant members can view movements" ON public.inventory_movements;
CREATE POLICY "Tenant members can view movements" ON public.inventory_movements
  FOR SELECT USING (
    public.is_tenant_member(tenant_id)
  );

DROP POLICY IF EXISTS "Shop owners can record movements" ON public.inventory_movements;
CREATE POLICY "Shop owners can record movements" ON public.inventory_movements
  FOR INSERT WITH CHECK (
    public.is_tenant_owner(tenant_id)
  );

-- No UPDATE and no DELETE policies: history can never be silently
-- overwritten or erased. Corrections happen through 'reversal' movements.

-- ---------------------------------------------------------------------------
-- 6. PRODUCTS: block assigning deactivated or foreign categories
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_active_category_on_product()
RETURNS TRIGGER AS $$
DECLARE v_cat RECORD;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id, is_active INTO v_cat
  FROM public.product_categories
  WHERE id = NEW.category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % does not exist', NEW.category_id;
  END IF;
  IF v_cat.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Category % belongs to another shop', NEW.category_id;
  END IF;
  IF v_cat.is_active = false THEN
    RAISE EXCEPTION 'Category % is deactivated — reassign the product to an active category', NEW.category_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_active_category_on_product ON public.products;
CREATE TRIGGER trg_enforce_active_category_on_product
  BEFORE INSERT OR UPDATE OF category_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_category_on_product();

-- Keep updated_at fresh on category edits
CREATE OR REPLACE FUNCTION public.touch_category_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_category_updated_at ON public.product_categories;
CREATE TRIGGER trg_touch_category_updated_at
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_category_updated_at();

-- ---------------------------------------------------------------------------
-- 7. ATOMIC STOCK MOVEMENT RPC (row-locked, concurrency-safe)
--    Used by the app when connected so concurrent sales/receipts can never
--    produce an incorrect balance or double-deduct stock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_stock_movement(
  p_tenant_id UUID,
  p_product_id UUID,
  p_type TEXT,
  p_qty NUMERIC,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_movement_id UUID DEFAULT NULL,
  p_movement_created_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(new_balance INT, new_avg_cost NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_product RECORD;
  v_delta NUMERIC;
  v_new_qty NUMERIC;
  v_value NUMERIC;
  v_new_avg NUMERIC;
BEGIN
  SELECT id, tenant_id, stock_quantity, cost_price, avg_cost, unit
    INTO v_product
  FROM public.products
  WHERE id = p_product_id AND tenant_id = p_tenant_id
  FOR UPDATE; -- serialize concurrent movements for this product

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found in tenant %', p_product_id, p_tenant_id;
  END IF;

  IF p_type IN ('opening_stock', 'restock', 'customer_return', 'transfer_in', 'refund') THEN
    v_delta := abs(p_qty);
  ELSIF p_type IN ('sale', 'supplier_return', 'damage', 'expired', 'transfer_out') THEN
    v_delta := -abs(p_qty);
  ELSIF p_type IN ('adjustment', 'reversal') THEN
    v_delta := p_qty; -- signed
  ELSE
    RAISE EXCEPTION 'Invalid movement type: %', p_type;
  END IF;

  v_new_qty := v_product.stock_quantity + v_delta;
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'Insufficient stock for %: only % available', v_product.id, v_product.stock_quantity;
  END IF;

  -- Weighted-average cost changes only on stock-in with an explicit cost
  v_value := v_product.stock_quantity * COALESCE(v_product.avg_cost, v_product.cost_price, 0);
  v_new_avg := COALESCE(v_product.avg_cost, v_product.cost_price, 0);
  IF v_delta > 0 AND p_unit_cost IS NOT NULL THEN
    v_new_avg := (v_value + abs(v_delta) * p_unit_cost) / NULLIF(v_product.stock_quantity + abs(v_delta), 0);
  END IF;

  UPDATE public.products
     SET stock_quantity = v_new_qty::INT,
         avg_cost = ROUND(v_new_avg, 4)
   WHERE id = p_product_id;

  INSERT INTO public.inventory_movements (
    id, tenant_id, branch_id, product_id, type, quantity,
    unit_cost, balance_after, reference_id, reference_type,
    reason, created_by, created_at
  ) VALUES (
    COALESCE(p_movement_id, gen_random_uuid()),
    p_tenant_id,
    p_branch_id,
    p_product_id,
    p_type,
    CASE WHEN p_type IN ('adjustment', 'reversal') THEN v_delta::INT ELSE abs(v_delta)::INT END,
    p_unit_cost,
    v_new_qty::INT,
    p_reference_id,
    p_reference_type,
    p_reason,
    COALESCE(p_created_by, auth.uid()),
    COALESCE(p_movement_created_at, timezone('utc'::text, now()))
  );

  RETURN QUERY SELECT v_new_qty::INT, ROUND(v_new_avg, 4);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stock_movement(UUID, UUID, TEXT, NUMERIC, NUMERIC, UUID, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_stock_movement(UUID, UUID, TEXT, NUMERIC, NUMERIC, UUID, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. REALTIME for categories (movements + products + sales already published)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'product_categories'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.product_categories;
  END IF;
END $$;
