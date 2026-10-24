import test from 'node:test';
import assert from 'node:assert';
import { db } from './supabaseClient.ts';

test('register creates new shop owner and dedicated supermarket tenant in database', () => {
  const email = `testowner_${Date.now()}@mart.com`;
  const result = db.register({
    full_name: 'Kojo Antwi',
    email,
    phone: '+233 24 999 1111',
    password: 'securepassword456',
    role: 'shop_owner',
    shop_name: 'Antwi Supermarket Osu',
    shop_address: 'Oxford Street, Osu',
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.user?.role, 'shop_owner');
  assert.strictEqual(result.user?.shop_name, 'Antwi Supermarket Osu');
  assert.ok(result.user?.tenant_id);

  // Check tenant was actually added to tenant database
  const tenants = db.getTenants();
  const createdTenant = tenants.find((t) => t.id === result.user?.tenant_id);
  assert.ok(createdTenant);
  assert.strictEqual(createdTenant?.name, 'Antwi Supermarket Osu');
});

test('login verifies valid registered user credentials and sets current user', async () => {
  const email = `login_test_${Date.now()}@mart.com`;
  db.register({
    full_name: 'Ama Serwaa',
    email,
    phone: '+233 24 333 4444',
    password: 'password789',
    role: 'shop_owner',
    shop_name: 'Ama Mart Spintex',
  });

  const result = await db.login(email, 'password789');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.user?.email, email);
  assert.strictEqual(db.getCurrentUser()?.email, email);
});

test('login rejects unknown emails', async () => {
  const result = await db.login('nonexistent@user.com', 'password123');
  assert.strictEqual(result.success, false);
  assert.ok(result.message);
});

test('logout clears the active user session', () => {
  const email = `logout_test_${Date.now()}@mart.com`;
  db.register({
    full_name: 'Test Logout User',
    email,
    phone: '+233 20 111 2222',
    password: 'password123',
    role: 'shop_owner',
    shop_name: 'Logout Test Shop',
  });

  assert.ok(db.getCurrentUser());
  db.logout();
  assert.strictEqual(db.getCurrentUser(), null);
});
