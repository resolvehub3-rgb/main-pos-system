import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomerDisplayUrl,
  buildWindowFeatures,
  detectMultiMonitorSync,
  pickCustomerScreen,
  screenBounds,
  supportsIsExtended,
  supportsWindowManagement,
  type ScreenLike,
} from './dualScreen.ts';
import {customerDisplayChannelName, sessionIdFromSearch} from './customerDisplayChannel.ts';

test('channel name is scoped to the till session', () => {
  assert.equal(customerDisplayChannelName('tenant-1:user-7'), 'samtill-customer-display:tenant-1:user-7');
  // Two cashiers on one machine never share a channel…
  assert.notEqual(customerDisplayChannelName('tenant-1:user-7'), customerDisplayChannelName('tenant-1:user-8'));
  // …and neither do two shops.
  assert.notEqual(customerDisplayChannelName('tenant-1:user-7'), customerDisplayChannelName('tenant-2:user-7'));
});

test('channel name without a session keeps the legacy name', () => {
  assert.equal(customerDisplayChannelName(null), 'samtill-customer-display');
  assert.equal(customerDisplayChannelName(undefined), 'samtill-customer-display');
  assert.equal(customerDisplayChannelName(''), 'samtill-customer-display');
});

test('session id round-trips through the popup query string', () => {
  const sid = 'tenant-accra:user-42';
  const url = buildCustomerDisplayUrl(sid, 'https://till.example');
  assert.equal(url, 'https://till.example/?view=customer-display&sid=tenant-accra%3Auser-42');
  assert.equal(sessionIdFromSearch(new URL(url).search), sid);
});

test('session id is absent from a hand-opened display URL', () => {
  const url = buildCustomerDisplayUrl(null, 'https://till.example');
  assert.equal(url, 'https://till.example/?view=customer-display');
  assert.equal(sessionIdFromSearch(new URL(url).search), null);
  assert.equal(sessionIdFromSearch('?view=customer-display'), null);
  assert.equal(sessionIdFromSearch('?view=customer-display&sid=%20'), null);
});

test('pickCustomerScreen prefers a non-primary monitor', () => {
  const primary: ScreenLike = {isPrimary: true, left: 0, top: 0, width: 1920, height: 1080};
  const secondary: ScreenLike = {isPrimary: false, left: 1920, top: 0, width: 1920, height: 1080};

  assert.equal(pickCustomerScreen([primary, secondary]), secondary);
  // Single monitor → no customer screen to pick.
  assert.equal(pickCustomerScreen([primary]), undefined);
  assert.equal(pickCustomerScreen([]), undefined);
});

test('pickCustomerScreen falls back to "not the current screen"', () => {
  const a: ScreenLike = {left: 0, top: 0, width: 1920, height: 1080};
  const b: ScreenLike = {left: 1920, top: 0, width: 1920, height: 1080};
  // Implementations without isPrimary: index of the current screen decides.
  assert.equal(pickCustomerScreen([a, b], 0), b);
  assert.equal(pickCustomerScreen([a, b], 1), a);
});

test('screenBounds prefers the full-screen origin and available size', () => {
  assert.deepEqual(
    screenBounds({left: 1920, top: 0, width: 2560, height: 1440, availWidth: 2560, availHeight: 1400}),
    {left: 1920, top: 0, width: 2560, height: 1400},
  );
  assert.deepEqual(screenBounds({}), {left: 0, top: 0, width: 0, height: 0});
});

test('window features centre the popup on the target screen', () => {
  const features = buildWindowFeatures({left: 1920, top: 0, width: 1920, height: 1080}, 1024, 700);
  assert.match(features, /popup=yes/);
  assert.match(features, /width=1024/);
  assert.match(features, /height=700/);
  // left = 1920 + (1920-1024)/2 = 2368, top = 0 + (1080-700)/2 = 190
  assert.match(features, /left=2368/);
  assert.match(features, /top=190/);
});

test('window features omit placement without a target screen', () => {
  const features = buildWindowFeatures(undefined, 1024, 700);
  assert.equal(features, 'popup=yes,width=1024,height=700');
  assert.equal(buildWindowFeatures(null), 'popup=yes,width=1024,height=700');
});

test('monitor detection degrades honestly in an environment without the APIs', () => {
  // The node test runner has no Window Management API and (normally) no
  // screen.isExtended — detection must say "unknown", never guess a count.
  if (supportsWindowManagement() || supportsIsExtended()) return; // real browser
  const report = detectMultiMonitorSync();
  assert.equal(report.multipleMonitors, null);
  assert.equal(report.monitorCount, null);
  assert.equal(report.source, 'unknown');
  assert.equal(report.target, undefined);
});
