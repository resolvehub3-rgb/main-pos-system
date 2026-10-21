-- ============================================================================
-- SAMTECH HELPER POS - SUPABASE SEED DATA (For Ghanaian Supermarket Setup)
-- ============================================================================

-- Subscription plans
INSERT INTO public.subscription_plans (id, name, slug, price_monthly, price_yearly, max_branches, max_users, max_products, features)
VALUES 
('11111111-1111-1111-1111-111111111111', 'Starter Shop', 'starter', 150.00, 1500.00, 1, 3, 500, '["single_branch", "basic_reports", "cash_and_momo"]'),
('22222222-2222-2222-2222-222222222222', 'Supermarket Pro', 'pro', 350.00, 3500.00, 3, 10, 2500, '["multi_branch", "realtime_analytics", "inventory_ledger", "all_payment_methods", "thermal_receipts"]'),
('33333333-3333-3333-3333-333333333333', 'Enterprise Supermarket', 'enterprise', 750.00, 7500.00, 10, 50, 10000, '["unlimited_branches", "custom_reports", "supplier_purchase_orders", "customer_display", "priority_support"]')
ON CONFLICT (slug) DO NOTHING;
