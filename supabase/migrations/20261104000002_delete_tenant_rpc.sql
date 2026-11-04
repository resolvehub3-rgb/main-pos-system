-- =============================================================================
-- SamTill POS — delete a tenant (shop) and all of its data
-- =============================================================================
--
-- A SECURITY DEFINER RPC so the client can remove a shop in one call without
-- needing direct DELETE grants on every child table. Restricted to super admins.
-- Children are deleted first to respect foreign keys; the tenant row is last.
-- =============================================================================

create or replace function public.delete_tenant(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin may delete a shop';
  end if;

  delete from public.inventory_movements where tenant_id = p_tenant_id;
  delete from public.sales where tenant_id = p_tenant_id;
  delete from public.product_categories where tenant_id = p_tenant_id;
  delete from public.products where tenant_id = p_tenant_id;
  delete from public.customers where tenant_id = p_tenant_id;
  delete from public.expenses where tenant_id = p_tenant_id;
  delete from public.cash_movements where tenant_id = p_tenant_id;
  delete from public.cash_register_shifts where tenant_id = p_tenant_id;
  delete from public.parked_carts where tenant_id = p_tenant_id;
  delete from public.branches where tenant_id = p_tenant_id;
  delete from public.users where tenant_id = p_tenant_id;
  delete from public.tenants where id = p_tenant_id;
end;
$$;

grant execute on function public.delete_tenant(uuid) to authenticated;