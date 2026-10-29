import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { db } from './supabaseClient.ts';
import type { UserAccount } from '../types/index';

/**
 * Stage A security regression tests.
 *
 * These lock in the fixes for the production-readiness audit's critical
 * findings:
 *  - client-side role escalation (register/addUser must not mint a super admin),
 *  - the "no stored password = open door" login hole,
 *  - credential leakage out of the device.
 *
 * A super admin can now only be created under an authenticated super-admin
 * session (production provisions the first one via the Supabase Admin API).
 * The tests establish that session directly where a privileged row is needed.
 */

const superAdminSession: UserAccount = {
  id: 'test-session-super-admin',
  full_name: 'Provisioned Admin',
  email: 'provisioned-admin@example.com',
  phone: '',
  role: 'super_admin',
  is_active: true,
  created_at: new Date().toISOString(),
};

function withSuperAdminSession<T>(fn: () => T): T {
  const prior = db.getCurrentUser();
  db.setCurrentUser(superAdminSession);
  try {
    return fn();
  } finally {
    db.setCurrentUser(prior);
  }
}

test('register cannot self-assign a privileged role', () => {
  const email = `esc_register_${Date.now()}@example.com`;
  const result = db.register({
    full_name: 'Escalation Attempt',
    email,
    phone: '+233 20 000 0001',
    password: 'some-strong-password',
    role: 'super_admin', // tampered request
    shop_name: 'Escalation Shop',
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.user?.role, 'shop_owner', 'a self-registration must never be super_admin');
});

test('addUser cannot mint a super admin without a super-admin session', () => {
  const prior = db.getCurrentUser();
  db.setCurrentUser({
    id: 'test-session-owner',
    full_name: 'Shop Owner',
    email: 'owner-for-escalation@example.com',
    phone: '',
    role: 'shop_owner',
    is_active: true,
    created_at: new Date().toISOString(),
  });
  try {
    const created = db.addUser({
      full_name: 'Escalated Staff',
      email: `esc_adduser_${Date.now()}@example.com`,
      phone: '+233 20 000 0002',
      role: 'super_admin', // tampered request from a non-super-admin session
      is_active: true,
    });
    assert.strictEqual(created.role, 'shop_owner', 'a shop-owner session must not create a super admin');
  } finally {
    db.setCurrentUser(prior);
  }
});

test('an authenticated super admin may still create a super admin', () => {
  const created = withSuperAdminSession(() =>
    db.addUser({
      full_name: 'Second Admin',
      email: `esc_admin_${Date.now()}@example.com`,
      phone: '+233 20 000 0003',
      role: 'super_admin',
      is_active: true,
    }),
  );
  assert.strictEqual(created.role, 'super_admin');
});

test('login is refused when the account has no stored sign-in credential', async () => {
  // An account synced/created without a password used to be an open door:
  // `if (user.password && …)` short-circuited and let anyone in by email.
  const email = `nocred_${Date.now()}@example.com`;
  db.addUser({
    full_name: 'No Credential User',
    email,
    phone: '+233 20 000 0004',
    role: 'cashier',
    is_active: true,
    // no password on purpose
  });

  const result = await db.login(email, 'anything');
  assert.strictEqual(result.success, false, 'an account with no credential must not sign in');
  assert.match(result.message ?? '', /no sign-in credential/i);
});

test('login still rejects a wrong password for a credentialed account', async () => {
  const email = `wrongpw_${Date.now()}@example.com`;
  db.register({
    full_name: 'Credentialed User',
    email,
    phone: '+233 20 000 0005',
    password: 'correct-horse-battery',
    role: 'shop_owner',
    shop_name: 'Credentialed Shop',
  });

  const bad = await db.login(email, 'not-the-password');
  assert.strictEqual(bad.success, false);

  const good = await db.login(email, 'correct-horse-battery');
  assert.strictEqual(good.success, true);
});

test('a cashier session cannot mint a super admin', () => {
  // Same coercion as the shop-owner case: only a super-admin session may grant
  // super_admin. A tampered cashier client is no exception.
  const prior = db.getCurrentUser();
  db.setCurrentUser({
    id: 'test-session-cashier',
    full_name: 'Till Operator',
    email: 'cashier-for-escalation@example.com',
    phone: '',
    role: 'cashier',
    is_active: true,
    created_at: new Date().toISOString(),
  });
  try {
    const created = db.addUser({
      full_name: 'Escalated From Till',
      email: `esc_cashier_${Date.now()}@example.com`,
      phone: '+233 20 000 0006',
      role: 'super_admin',
      is_active: true,
    });
    assert.strictEqual(created.role, 'shop_owner', 'a cashier session must not create a super admin');
  } finally {
    db.setCurrentUser(prior);
  }
});

test('a deactivated account cannot sign in', async () => {
  // Disabled users must be refused even with the correct password — the
  // is_active gate runs before the credential check.
  const email = `disabled_${Date.now()}@example.com`;
  const created = db.register({
    full_name: 'Disabled User',
    email,
    phone: '+233 20 000 0007',
    password: 'still-the-password',
    role: 'shop_owner',
    shop_name: 'Disabled Shop',
  });
  assert.ok(created.user);
  db.logout();
  db.toggleUserStatus(created.user!.id); // deactivate

  const result = await db.login(email, 'still-the-password');
  assert.strictEqual(result.success, false, 'a deactivated account must not sign in');
  assert.match(result.message ?? '', /deactivated/i);
});

test('logout clears the session so a subsequent login is required', async () => {
  // Session lifecycle: after logout there must be no current user, and the
  // same credentials must be re-presented to regain access.
  const email = `session_${Date.now()}@example.com`;
  db.register({
    full_name: 'Session User',
    email,
    phone: '+233 20 000 0008',
    password: 'session-password',
    role: 'shop_owner',
    shop_name: 'Session Shop',
  });
  assert.ok(db.getCurrentUser(), 'register signs the user in');

  db.logout();
  assert.strictEqual(db.getCurrentUser(), null, 'logout must clear the session');

  const back = await db.login(email, 'session-password');
  assert.strictEqual(back.success, true, 'the same credentials regain access');
});
