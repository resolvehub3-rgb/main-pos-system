import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { evaluateTenantAccess } from './subscriptionGate.ts';
import type { Tenant } from '../types/index';

const baseTenant: Tenant = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Makola Fresh Mart',
  slug: 'makola-fresh-mart',
  phone: '0244000001',
  email: 'owner@makolafresh.com',
  address: 'Accra',
  currency: 'GHS',
  is_active: true,
  subscription_status: 'active',
  subscription_plan_code: 'samtill-pos-6m',
  subscription_started_at: '2026-10-01T00:00:00.000Z',
  subscription_expires_at: '2027-04-01T00:00:00.000Z',
  created_at: '2026-10-01T00:00:00.000Z',
};

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

test('super_admin always bypasses shop subscription gating', () => {
  const decision = evaluateTenantAccess({ role: 'super_admin' }, null, NOW);
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'super_admin');
});

test('active unexpired tenant grants access to shop_owner and cashier', () => {
  const owner = evaluateTenantAccess({ role: 'shop_owner' }, baseTenant, NOW);
  assert.equal(owner.allowed, true);
  assert.equal(owner.reason, 'active');

  const cashier = evaluateTenantAccess({ role: 'cashier' }, baseTenant, NOW);
  assert.equal(cashier.allowed, true);
  assert.equal(cashier.reason, 'active');
});

test('expired 6-month subscription blocks access and marks reason expired', () => {
  const expiredTenant: Tenant = {
    ...baseTenant,
    subscription_expires_at: '2026-11-01T00:00:00.000Z',
  };
  const decision = evaluateTenantAccess({ role: 'shop_owner' }, expiredTenant, NOW);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'expired');
  assert.equal(decision.expiresAt, '2026-11-01T00:00:00.000Z');
});

test('trial, past_due, suspended, inactive, and missing tenants block access', () => {
  assert.equal(
    evaluateTenantAccess({ role: 'shop_owner' }, { ...baseTenant, subscription_status: 'trial' }, NOW).reason,
    'trial',
  );
  assert.equal(
    evaluateTenantAccess({ role: 'shop_owner' }, { ...baseTenant, subscription_status: 'past_due' }, NOW).reason,
    'past_due',
  );
  assert.equal(
    evaluateTenantAccess({ role: 'cashier' }, { ...baseTenant, subscription_status: 'suspended' }, NOW).reason,
    'suspended',
  );
  assert.equal(
    evaluateTenantAccess({ role: 'shop_owner' }, { ...baseTenant, is_active: false }, NOW).reason,
    'suspended',
  );
  assert.equal(evaluateTenantAccess({ role: 'shop_owner' }, null, NOW).reason, 'missing_tenant');
});
