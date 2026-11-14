import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authPathFor,
  isAuthEntryPath,
  rolePathFor,
  syncAuthUrl,
  WORKSPACE_PATHS,
} from './roleRoute.ts';

test('each role has its own workspace URL', () => {
  assert.equal(rolePathFor('super_admin'), '/admin');
  assert.equal(rolePathFor('shop_owner'), '/shop-owner');
  assert.equal(rolePathFor('cashier'), '/cashier');
  // A role this build does not recognise still opens a workspace — it must
  // never be handed an auth page while a session exists.
  assert.equal(rolePathFor('superadmin'), '/app');
});

test('the workspace paths are the ones the POS entry point recognises', () => {
  for (const role of ['super_admin', 'shop_owner', 'cashier']) {
    assert.ok(WORKSPACE_PATHS.includes(rolePathFor(role)), `${role} path is a workspace`);
  }
  // Auth pages are entry points, not workspaces.
  assert.ok(!WORKSPACE_PATHS.includes('/login'));
  assert.ok(!WORKSPACE_PATHS.includes('/register'));
  assert.ok(isAuthEntryPath('/login') && isAuthEntryPath('/register'));
  assert.ok(!isAuthEntryPath('/admin'));
});

test('signing in never leaves /register (or /login) in the address bar', () => {
  // The complaint this exists for: login from the register tab must land on
  // the role's URL, whatever the arrival URL was.
  assert.equal(authPathFor({ role: 'super_admin' }, '/register'), '/admin');
  assert.equal(authPathFor({ role: 'shop_owner' }, '/register'), '/shop-owner');
  assert.equal(authPathFor({ role: 'cashier' }, '/register'), '/cashier');
  assert.equal(authPathFor({ role: 'cashier' }, '/login'), '/cashier');
});

test('a logged-out deep link keeps working per page', () => {
  // /register must remain the register page for people who have not signed up.
  assert.equal(authPathFor(null, '/register'), '/register');
  assert.equal(authPathFor(null, '/login'), '/login');
  // A workspace URL with no session behind it resolves to the login screen —
  // the URL may not claim to be a dashboard that is not rendered.
  assert.equal(authPathFor(null, '/admin'), '/login');
  assert.equal(authPathFor(null, '/shop-owner'), '/login');
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
  const { stub, written } = fakeBrowser('/register', '?source=nav');
  withBrowser(stub, () => syncAuthUrl({ role: 'cashier' }));

  assert.deepEqual(written, ['/cashier?source=nav']);
});

test('syncAuthUrl rewrites to /login on sign-out and stays put when already right', () => {
  const logout = fakeBrowser('/shop-owner');
  withBrowser(logout.stub, () => syncAuthUrl(null));
  assert.deepEqual(logout.written, ['/login']);

  // Nothing to do — no history churn for a URL that is already correct.
  const settled = fakeBrowser('/admin');
  withBrowser(settled.stub, () => syncAuthUrl({ role: 'super_admin' }));
  assert.deepEqual(settled.written, []);
});
