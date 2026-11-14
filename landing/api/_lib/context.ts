/**
 * Loads the database state a provider event needs, producing the
 * ReduceContext consumed by the pure event reducer.
 *
 * Shared by /api/webhooks/paystack and /api/verify so both paths see the
 * same rows in the same shape. All reads use the service role (server-only).
 *
 * Loading strategy:
 *   - order        by the event's transaction reference (or a pre-loaded row),
 *   - plan         from the order's plan_code (never from event payload),
 *   - entitlement  the widest current window for the user + product,
 *   - subscription by Paystack subscription code when the event carries one,
 *   - profile      by customer email — only used to link a subscription row
 *                  that arrives before its charge.
 */

import type {CommerceConfig} from './env.ts';
import {PRODUCT_CODE} from './entitlement.ts';
import type {EventKeys, ProviderEvent, ReduceContext} from './event-reducer.ts';
import {selectRows} from './supabase.ts';

/** Row shapes (snake_case) as returned by PostgREST. */
export interface OrderRow {
  id: string;
  reference: string;
  user_id: string;
  tenant_id: string | null;
  plan_code: string;
  amount_minor: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  paid_at: string | null;
  paystack_transaction_id: number | null;
}

export interface EntitlementRowFull {
  id: string;
  user_id: string;
  tenant_id: string | null;
  product_code: string;
  plan_code: string | null;
  source_order_id: string | null;
  status: 'active' | 'expired' | 'revoked';
  valid_from: string;
  valid_to: string;
}

export interface SubscriptionRowFull {
  id: string;
  user_id: string | null;
  tenant_id: string | null;
  plan_code: string | null;
  paystack_subscription_code: string | null;
  status: 'active' | 'attention' | 'non_renewing' | 'cancelled' | 'completed';
  auto_renew: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
}

export interface TenantMembershipRow {
  tenant_id: string;
  role: string;
}

export interface TenantBillingRow {
  id: string;
  name: string;
  is_active: boolean;
  subscription_status: string;
  subscription_plan_code: string | null;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  last_payment_reference: string | null;
}

export interface PlanRowFull {
  code: string;
  interval_months: number;
  entitlement_product: string;
}

export interface ProfileRow {
  id: string;
}

const ORDER_COLUMNS =
  'id,reference,user_id,tenant_id,plan_code,amount_minor,currency,status,paid_at,paystack_transaction_id';
const ENTITLEMENT_COLUMNS =
  'id,user_id,tenant_id,product_code,plan_code,source_order_id,status,valid_from,valid_to';
const SUBSCRIPTION_COLUMNS =
  'id,user_id,tenant_id,plan_code,paystack_subscription_code,status,auto_renew,current_period_start,current_period_end,cancel_at_period_end,cancelled_at';
const TENANT_COLUMNS =
  'id,name,is_active,subscription_status,subscription_plan_code,subscription_started_at,subscription_expires_at,last_payment_reference';

function eq(value: string): string {
  return encodeURIComponent(value);
}

export async function loadActiveMembershipForUser(
  config: CommerceConfig,
  userId: string,
): Promise<TenantMembershipRow | null> {
  const rows = await selectRows<TenantMembershipRow>(
    config,
    'tenant_memberships',
    `user_id=eq.${eq(userId)}&is_active=eq.true&select=tenant_id,role&order=created_at.asc&limit=1`,
  );
  return rows[0] ?? null;
}

export async function loadTenantById(
  config: CommerceConfig,
  tenantId: string,
): Promise<TenantBillingRow | null> {
  const rows = await selectRows<TenantBillingRow>(
    config,
    'tenants',
    `id=eq.${eq(tenantId)}&select=${TENANT_COLUMNS}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function loadOrder(
  config: CommerceConfig,
  reference: string,
): Promise<OrderRow | null> {
  const rows = await selectRows<OrderRow>(
    config,
    'orders',
    `reference=eq.${eq(reference)}&select=${ORDER_COLUMNS}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function loadEntitlementForUser(
  config: CommerceConfig,
  userId: string,
  productCode: string = PRODUCT_CODE,
): Promise<EntitlementRowFull | null> {
  const rows = await selectRows<EntitlementRowFull>(
    config,
    'entitlements',
    `user_id=eq.${eq(userId)}&product_code=eq.${eq(productCode)}&select=${ENTITLEMENT_COLUMNS}&order=valid_to.desc&limit=1`,
  );
  return rows[0] ?? null;
}

/** All entitlements for a user, widest window first. */
export async function loadEntitlementsForUser(
  config: CommerceConfig,
  userId: string,
  productCode: string = PRODUCT_CODE,
): Promise<EntitlementRowFull[]> {
  return selectRows<EntitlementRowFull>(
    config,
    'entitlements',
    `user_id=eq.${eq(userId)}&product_code=eq.${eq(productCode)}&select=${ENTITLEMENT_COLUMNS}&order=valid_to.desc`,
  );
}

/** Most recent subscription row for a user, if any. */
export async function loadSubscriptionForUser(
  config: CommerceConfig,
  userId: string,
): Promise<SubscriptionRowFull | null> {
  const rows = await selectRows<SubscriptionRowFull>(
    config,
    'subscriptions',
    `user_id=eq.${eq(userId)}&select=${SUBSCRIPTION_COLUMNS}&order=created_at.desc&limit=1`,
  );
  return rows[0] ?? null;
}

export async function loadPlan(config: CommerceConfig, planCode: string): Promise<PlanRowFull | null> {
  const rows = await selectRows<PlanRowFull>(
    config,
    'plans',
    `code=eq.${eq(planCode)}&select=code,interval_months,entitlement_product&limit=1`,
  );
  return rows[0] ?? null;
}

export interface LoadContextOptions {
  /** Pre-loaded order (the verify path already has it). */
  order?: OrderRow | null;
}

/**
 * Build the ReduceContext for an event. Reads are issued in parallel where
 * they do not depend on each other.
 */
export async function loadReduceContext(
  config: CommerceConfig,
  event: ProviderEvent,
  keys: EventKeys,
  options: LoadContextOptions = {},
): Promise<ReduceContext> {
  let order =
    options.order !== undefined
      ? options.order
      : keys.orderReference !== null
        ? await loadOrder(config, keys.orderReference)
        : null;

  if (order && !order.tenant_id) {
    const membership = await loadActiveMembershipForUser(config, order.user_id).catch(() => null);
    if (membership) {
      order = {...order, tenant_id: membership.tenant_id};
    }
  }

  const [plan, entitlement, subscription, profile] = await Promise.all([
    order !== null ? loadPlan(config, order.plan_code) : Promise.resolve(null),
    order !== null
      ? loadEntitlementForUser(config, order.user_id)
      : Promise.resolve(null),
    keys.subscriptionCode !== null
      ? selectRows<SubscriptionRowFull>(
          config,
          'subscriptions',
          `paystack_subscription_code=eq.${eq(keys.subscriptionCode)}&select=${SUBSCRIPTION_COLUMNS}&limit=1`,
        ).then((rows) => rows[0] ?? null)
      : order !== null
        ? loadSubscriptionForUser(config, order.user_id)
        : Promise.resolve(null),
    keys.customerEmail !== null
      ? selectRows<ProfileRow>(
          config,
          'profiles',
          `email=eq.${eq(keys.customerEmail)}&select=id&limit=1`,
        ).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  return {
    event,
    order,
    entitlement: entitlement as ReduceContext['entitlement'],
    subscription: subscription as ReduceContext['subscription'],
    profile,
    plan,
    now: new Date(),
  };
}
