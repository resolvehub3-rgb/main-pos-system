/**
 * Ensure an authenticated owner has their SamTill POS tenant/shop provisioned
 * via the existing SECURITY DEFINER `create_tenant_with_owner` Postgres RPC.
 *
 * Idempotent: returns existing membership tenant_id without creating a
 * duplicate shop or profile.
 */

import type {SupabaseClient} from '@supabase/supabase-js';

export interface ShopProvisionOverrides {
  shopName?: string;
  shopAddress?: string;
  fullName?: string;
  phone?: string;
}

export interface EnsureShopResult {
  ok: boolean;
  tenantId?: string;
  skipped?: boolean;
  error?: string;
}

function cleanStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function ensureProvisionedShop(
  client: SupabaseClient,
  overrides: ShopProvisionOverrides = {},
  options: {createFallbackIfMissing?: boolean} = {},
): Promise<EnsureShopResult> {
  try {
    const {data: userData, error: userError} = await client.auth.getUser();
    const user = userData?.user;
    if (userError || !user) {
      return {ok: false, error: 'Sign in required before setting up your shop.'};
    }

    // Check existing active membership first (avoids unnecessary RPC call and guarantees no duplicates).
    const {data: memberships} = await client
      .from('tenant_memberships')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1);

    const existingTenantId =
      Array.isArray(memberships) && memberships[0]?.tenant_id
        ? String(memberships[0].tenant_id)
        : '';

    if (existingTenantId) {
      return {ok: true, tenantId: existingTenantId};
    }

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const shopName =
      cleanStr(overrides.shopName) ||
      cleanStr(meta.shop_name) ||
      (options.createFallbackIfMissing ? 'My SamTill Store' : '');

    if (!shopName) {
      return {ok: true, skipped: true};
    }

    const shopAddress = cleanStr(overrides.shopAddress) || cleanStr(meta.shop_address) || null;
    const ownerName = cleanStr(overrides.fullName) || cleanStr(meta.full_name) || null;
    const ownerPhone = cleanStr(overrides.phone) || cleanStr(meta.phone) || null;

    const {data: tenantId, error: rpcError} = await client.rpc('create_tenant_with_owner', {
      p_shop_name: shopName,
      p_shop_address: shopAddress,
      p_owner_name: ownerName,
      p_owner_phone: ownerPhone,
    });

    if (rpcError) {
      return {ok: false, error: rpcError.message || 'Could not set up your shop workspace.'};
    }

    return {ok: true, tenantId: typeof tenantId === 'string' ? tenantId : undefined};
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not complete shop setup.',
    };
  }
}
