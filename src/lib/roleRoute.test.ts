import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authPathFor,
  isAuthEntryPath,
  isPosPath,
  isTerminalPath,
  pathFromShopOwnerMenu,
  POS_ADMIN_PATH,
  POS_DASHBOARD_PATH,
  POS_INVENTORY_PATH,
  POS_LOGIN_PATH,
  POS_PRODUCTS_PATH,
  POS_REGISTER_PATH,
  POS_REPORTS_PATH,
  POS_SETTINGS_PATH,
  POS_TERMINAL_PATH,
  rolePathFor,
  shopOwnerMenuFromPath,
  syncAuthUrl,
} from './roleRoute.ts';

test('each role has its own /app/ workspace URL', () => {
  assert.equal(rolePathFor('super_admin'), POS_ADMIN_PATH);
  assert.equal(rolePathFor('shop_owner'), POS_DASHBOARD_PATH);
  assert.equal(rolePathFor('cashier'), POS_TERMINAL_PATH);
  assert.equal(rolePathFor('unknown_role'), POS_DASHBOARD_PATH);
});

test('isPosPath isolates /app/* and legacy POS paths from marketing routes', () => {
  assert.equal(isPosPath('/app'), true);
  assert.equal(isPosPath('/app/'), true);
  assert.equal(isPosPath('/app/login'), true);
  assert.equal(isPosPath('/app/dashboard'), true);
  assert.equal(isPosPath('/app/pos'), true);
  assert.equal(isPosPath('/app/products'), true);
  assert.equal(isPosPath('/app/inventory'), true);
  assert.equal(isPosPath('/app/reports'), true);
  assert.equal(isPosPath('/app/settings'), true);
  assert.equal(isPosPath('/login'), true);
  assert.equal(isPosPath('/register'), true);

  // Public marketing routes must NEVER be treated as POS routes.
  assert.equal(isPosPath('/'), false);
  assert.equal(isPosPath('/features'), false);
  assert.equal(isPosPath('/pricing'), false);
  assert.equal(isPosPath('/about'), false);
  assert.equal(isPosPath('/contact'), false);
  assert.equal(isPosPath('/download'), false);
});

test('isAuthEntryPath recognizes /app/login, /app/register and legacy aliases', () => {
  assert.equal(isAuthEntryPath('/app/login'), true);
  assert.equal(isAuthEntryPath('/app/register'), true);
  assert.equal(isAuthEntryPath('/login'), true);
  assert.equal(isAuthEntryPath('/register'), true);
  assert.equal(isAuthEntryPath('/app/dashboard'), false);
  assert.equal(isAuthEntryPath('/'), false);
});

test('signing in redirects away from /app/login, /app/register, and /app/ to role dashboard', () => {
  assert.equal(authPathFor({ role: 'super_admin' }, '/app/register'), POS_ADMIN_PATH);
  assert.equal(authPathFor({ role: 'shop_owner' }, '/app/register'), POS_DASHBOARD_PATH);
  assert.equal(authPathFor({ role: 'shop_owner' }, '/app/login'), POS_DASHBOARD_PATH);
  assert.equal(authPathFor({ role: 'shop_owner' }, '/app/'), POS_DASHBOARD_PATH);
  assert.equal(authPathFor({ role: 'cashier' }, '/app/login'), POS_TERMINAL_PATH);
  assert.equal(authPathFor({ role: 'cashier' }, '/app/'), POS_TERMINAL_PATH);
});

test('authenticated sub-routes are preserved on refresh for authorized roles and blocked for unauthorized roles', () => {
  assert.equal(authPathFor({ role: 'shop_owner' }, POS_PRODUCTS_PATH), POS_PRODUCTS_PATH);
  assert.equal(authPathFor({ role: 'shop_owner' }, POS_INVENTORY_PATH), POS_INVENTORY_PATH);
  assert.equal(authPathFor({ role: 'shop_owner' }, POS_REPORTS_PATH), POS_REPORTS_PATH);
  assert.equal(authPathFor({ role: 'shop_owner' }, POS_SETTINGS_PATH), POS_SETTINGS_PATH);
  assert.equal(authPathFor({ role: 'shop_owner' }, POS_TERMINAL_PATH), POS_TERMINAL_PATH);
  assert.equal(authPathFor({ role: 'shop_owner' }, POS_ADMIN_PATH), POS_DASHBOARD_PATH);

  // Cashiers only have access to the sales terminal (/app/pos)
  assert.equal(authPathFor({ role: 'cashier' }, POS_TERMINAL_PATH), POS_TERMINAL_PATH);
  assert.equal(authPathFor({ role: 'cashier' }, POS_DASHBOARD_PATH), POS_TERMINAL_PATH);
  assert.equal(authPathFor({ role: 'cashier' }, POS_SETTINGS_PATH), POS_TERMINAL_PATH);

  // Super admin only uses /app/admin
  assert.equal(authPathFor({ role: 'super_admin' }, POS_ADMIN_PATH), POS_ADMIN_PATH);
  assert.equal(authPathFor({ role: 'super_admin' }, POS_DASHBOARD_PATH), POS_ADMIN_PATH);
});

test('logged-out visitors on any protected /app/* route redirect to /app/login, never /', () => {
  assert.equal(authPathFor(null, '/app'), POS_LOGIN_PATH);
  assert.equal(authPathFor(null, '/app/'), POS_LOGIN_PATH);
  assert.equal(authPathFor(null, POS_DASHBOARD_PATH), POS_LOGIN_PATH);
  assert.equal(authPathFor(null, POS_TERMINAL_PATH), POS_LOGIN_PATH);
  assert.equal(authPathFor(null, POS_PRODUCTS_PATH), POS_LOGIN_PATH);
  assert.equal(authPathFor(null, POS_INVENTORY_PATH), POS_LOGIN_PATH);
  assert.equal(authPathFor(null, POS_REPORTS_PATH), POS_LOGIN_PATH);
  assert.equal(authPathFor(null, POS_SETTINGS_PATH), POS_LOGIN_PATH);
  assert.equal(authPathFor(null, POS_ADMIN_PATH), POS_LOGIN_PATH);
  assert.equal(authPathFor(null, '/login'), POS_LOGIN_PATH);

  // /app/register (and legacy /register) stays on /app/register
  assert.equal(authPathFor(null, '/app/register'), POS_REGISTER_PATH);
  assert.equal(authPathFor(null, '/register'), POS_REGISTER_PATH);
});

test('shop owner menu maps cleanly to and from /app/* paths', () => {
  assert.equal(pathFromShopOwnerMenu('overview'), POS_DASHBOARD_PATH);
  assert.equal(pathFromShopOwnerMenu('products'), POS_PRODUCTS_PATH);
  assert.equal(pathFromShopOwnerMenu('inventory'), POS_INVENTORY_PATH);
  assert.equal(pathFromShopOwnerMenu('reports'), POS_REPORTS_PATH);
  assert.equal(pathFromShopOwnerMenu('settings'), POS_SETTINGS_PATH);

  assert.equal(shopOwnerMenuFromPath(POS_DASHBOARD_PATH), 'overview');
  assert.equal(shopOwnerMenuFromPath(POS_PRODUCTS_PATH), 'products');
  assert.equal(shopOwnerMenuFromPath(POS_INVENTORY_PATH), 'inventory');
  assert.equal(shopOwnerMenuFromPath(POS_REPORTS_PATH), 'reports');
  assert.equal(shopOwnerMenuFromPath(POS_SETTINGS_PATH), 'settings');
  assert.equal(isTerminalPath(POS_TERMINAL_PATH), true);
  assert.equal(isTerminalPath(POS_DASHBOARD_PATH), false);
});

/** Minimal browser stand-in: records what the URL was rewritten to. */
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

  assert.deepEqual(written, ['/app/pos?source=nav']);
});

test('syncAuthUrl rewrites to /app/login on sign-out and stays put when already right', () => {
  const logout = fakeBrowser('/app/dashboard');
  withBrowser(logout.stub, () => syncAuthUrl(null));
  assert.deepEqual(logout.written, ['/app/login']);

  const settled = fakeBrowser('/app/admin');
  withBrowser(settled.stub, () => syncAuthUrl({ role: 'super_admin' }));
  assert.deepEqual(settled.written, []);
});
