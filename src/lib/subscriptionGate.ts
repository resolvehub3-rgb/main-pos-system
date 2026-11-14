import type { Tenant, UserAccount } from '../types/index.ts';

export type SubscriptionGateReason =
  | 'super_admin'
  | 'active'
  | 'trial'
  | 'past_due'
  | 'expired'
  | 'suspended'
  | 'missing_tenant';

export interface TenantAccessDecision {
  allowed: boolean;
  reason: SubscriptionGateReason;
  expiresAt: string | null;
  title: string;
  message: string;
}

/**
 * Pure access evaluation for POS workspaces (`/app/*`).
 *
 * - `super_admin` is platform governance and is never blocked by shop billing.
 * - `shop_owner` and `cashier` require an active tenant with
 *   `subscription_status === 'active'` and an unexpired `subscription_expires_at`
 *   (when populated).
 */
export function evaluateTenantAccess(
  user: Pick<UserAccount, 'role'>,
  tenant: Pick<Tenant, 'is_active' | 'subscription_status' | 'subscription_expires_at'> | null | undefined,
  nowMs: number = Date.now(),
): TenantAccessDecision {
  if (user.role === 'super_admin') {
    return {
      allowed: true,
      reason: 'super_admin',
      expiresAt: null,
      title: 'Platform Admin Access',
      message: '',
    };
  }

  if (!tenant) {
    return {
      allowed: false,
      reason: 'missing_tenant',
      expiresAt: null,
      title: 'Activate Your SamTill POS Subscription',
      message:
        'Your shop workspace needs an active 6-Month Subscription before POS operations can start.',
    };
  }

  if (!tenant.is_active || tenant.subscription_status === 'suspended') {
    return {
      allowed: false,
      reason: 'suspended',
      expiresAt: tenant.subscription_expires_at ?? null,
      title: 'Workspace Suspended',
      message:
        'This shop subscription is currently suspended. Renew or reactivate the 6-Month Subscription to restore POS access.',
    };
  }

  const expiresAt = tenant.subscription_expires_at ?? null;
  if (tenant.subscription_status === 'active') {
    if (expiresAt) {
      const expiresMs = Date.parse(expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
        return {
          allowed: false,
          reason: 'expired',
          expiresAt,
          title: '6-Month Subscription Expired',
          message:
            'Your 6-month SamTill POS access period has ended. Complete a single GH₵500.00 payment to unlock another 6 months.',
        };
      }
    }
    return {
      allowed: true,
      reason: 'active',
      expiresAt,
      title: 'Subscription Active',
      message: '',
    };
  }

  if (tenant.subscription_status === 'past_due') {
    return {
      allowed: false,
      reason: 'past_due',
      expiresAt,
      title: 'Subscription Renewal Required',
      message:
        'Your SamTill POS subscription requires renewal. Pay GH₵500.00 to activate 6 months of uninterrupted access.',
    };
  }

  return {
    allowed: false,
    reason: 'trial',
    expiresAt,
    title: '6-Month Subscription Required',
    message:
      'Complete a single upfront payment of GH₵500.00 to activate your SamTill POS workspace for 6 months.',
  };
}
