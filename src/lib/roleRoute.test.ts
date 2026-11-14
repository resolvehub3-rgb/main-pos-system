import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authPathFor,
  isAuthEntryPath,
  isPosAppPath,
  legacyPosRedirect,
  rolePathFor,
  sectionForShopOwnerPath,
  shopOwnerPathForSection,
  syncAuthUrl,
  WORKSPACE_PATHS,
} from './roleRoute.ts';

test('each role has its own /app/ workspace URL', () => {
  assert.equal(rolePathFor('super_admin'), '/app/admin');
  assert.equal(rolePathFor('shop_owner'), '/app/shop-owner');
  assert.equal(rolePathFor('cashier'), '/app/cashier');
  assert.equal(rolePathFor('superadmin'), '/app/dashboard');
});

test('the workspace paths stay strictly inside /app/', () => {
  for (const role of ['super_admin', 'shop_owner', 'cashier']) {
    assert.ok(WORKSPACE_PATHS.includes(rolePathFor(role)), `${role} path is a workspace`);
    assert.ok(rolePathFor(role).startsWith('/app/'), `${role} path uses /app/ namespace`);
  }
  assert.ok(!WORKSPACE_PATHS.includes('/app/login'));
  assert.ok(!WORKSPACE_PATHS.includes('/app/register'));
  assert.ok(isAuthEntryPath('/app/login') && isAuthEntryPath('/app/register'));
  assert.ok(!isAuthEntryPath('/app/admin'));
});

test('legacy POS paths map cleanly into /app/ and are recognized as POS routes', () => {
  assert.equal(legacyPosRedirect('/login'), '/app/login');
  assert.equal(legacyPosRedirect('/register'), '/app/register');
  assert.equal(legacyPosRedirect('/admin'), '/app/admin');
  assert.equal(legacyPosRedirect('/shop-owner'), '/app/shop-owner');
  assert.equal(legacyPosRedirect('/cashier'), '/app/cashier');
  assert.equal(legacyPosRedirect('/pricing'), null);

  assert.equal(isPosAppPath('/app'), true);
  assert.equal(isPosAppPath('/app/'), true);
  assert.equal(isPosAppPath('/app/login'), true);
  assert.equal(isPosAppPath('/app/dashboard'), true);
  assert.equal(isPosAppPath('/app/pos'), true);
  assert.equal(isPosAppPath('/login'), true);
  assert.equal(isPosAppPath('/'), false);
  assert.equal(isPosAppPath('/pricing'), false);
  assert.equal(isPosAppPath('/download'), false);
});

test('signing in routes to /app/* role URL or preserves deep sub-route for authorized role', () => {
  assert.equal(authPathFor({ role: 'super_admin' }, '/app/register'), '/app/admin');
  assert.equal(authPathFor({ role: 'shop_owner' }, '/app/register'), '/app/shop-owner');
  assert.equal(authPathFor({ role: 'cashier' }, '/app/login'), '/app/cashier');
  assert.equal(authPathFor({ role: 'shop_owner' }, '/app/'), '/app/shop-owner');
  // Deep POS sub-routes preserved for shop owner
  assert.equal(authPathFor({ role: 'shop_owner' }, '/app/products'), '/app/products');
  assert.equal(authPathFor({ role: 'shop_owner' }, '/app/pos'), '/app/pos');
  assert.equal(authPathFor({ role: 'shop_owner' }, '/app/reports'), '/app/reports');
  // Cashiers cannot access owner-only paths like /app/settings
  assert.equal(authPathFor({ role: 'cashier' }, '/app/settings'), '/app/cashier');
  assert.equal(authPathFor({ role: 'cashier' }, '/app/pos'), '/app/pos');
});

test('logged-out deep links resolve cleanly to /app/login except /app/register', () => {
  assert.equal(authPathFor(null, '/app/register'), '/app/register');
  assert.equal(authPathFor(null, '/register'), '/app/register');
  assert.equal(authPathFor(null, '/app/login'), '/app/login');
  assert.equal(authPathFor(null, '/app/'), '/app/login');
  assert.equal(authPathFor(null, '/app/dashboard'), '/app/login');
  assert.equal(authPathFor(null, '/app/admin'), '/app/login');
  assert.equal(authPathFor(null, '/app/shop-owner'), '/app/login');
  assert.equal(authPathFor(null, '/admin'), '/app/login');
});

test('shop owner section <-> /app/* path helpers stay consistent', () => {
  assert.equal(shopOwnerPathForSection('overview', true), '/app/pos');
  assert.equal(shopOwnerPathForSection('products', false), '/app/products');
  assert.equal(shopOwnerPathForSection('inventory', false), '/app/inventory');
  assert.equal(shopOwnerPathForSection('reports', false), '/app/reports');
  assert.equal(shopOwnerPathForSection('settings', false), '/app/settings');

  assert.deepEqual(sectionForShopOwnerPath('/app/pos'), { section: 'overview', viewingPOS: true });
  assert.deepEqual(sectionForShopOwnerPath('/app/products'), { section: 'products', viewingPOS: false });
  assert.deepEqual(sectionForShopOwnerPath('/app/inventory'), { section: 'inventory', viewingPOS: false });
});

function fakeBrowser(pathname: string, search = '', hash = '') {
  const written: string[] = [];
  const stub = {
    location: { pathname, search, hash },
    history: {
      replaceState(_state: unknown, _title: string, url: string) {
        written.push(url);
      },
    },
  };
  return { stub, written };
}

function withBrowser<T>(stub: unknown, run: () => T): T {
  (globalThis as { window?: unknown }).window = stub;
  try {
    return run();
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
}

test('syncAuthUrl rewrites the URL on sign-in and carries the query along', () => {
  const { stub, written } = fakeBrowser('/app/register', '?source=nav');
  withBrowser(stub, () => syncAuthUrl({ role: 'cashier' }));

  assert.deepEqual(written, ['/app/cashier?source=nav']);
});

test('syncAuthUrl rewrites to /app/login on sign-out and stays put when already right', () => {
  const logout = fakeBrowser('/app/shop-owner');
  withBrowser(logout.stub, () => syncAuthUrl(null));
  assert.deepEqual(logout.written, ['/app/login']);

  const settled = fakeBrowser('/app/admin');
  withBrowser(settled.stub, () => syncAuthUrl({ role: 'super_admin' }));
  assert.deepEqual(settled.written, []);
});
