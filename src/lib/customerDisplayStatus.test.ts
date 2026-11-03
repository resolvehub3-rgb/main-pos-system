import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveCustomerDisplayConnection} from './customerDisplayStatus.ts';
import {isFullscreenActive, isFullscreenSupported} from './fullscreen.ts';

const base = {
  enabled: true,
  hasWindow: false,
  current: 'not-open' as const,
  lastAliveAt: 0,
  now: 1_000_000,
};

test('dual-screen disabled with no window reports off', () => {
  assert.equal(deriveCustomerDisplayConnection({...base, enabled: false}), 'off');
});

test('a window handle without a heartbeat is connecting', () => {
  assert.equal(deriveCustomerDisplayConnection({...base, hasWindow: true}), 'connecting');
});

test('a recent heartbeat means connected — even without a handle', () => {
  // The cashier window reloaded while the display stayed open: the display
  // keeps pinging, so the status must still read as connected.
  assert.equal(
    deriveCustomerDisplayConnection({...base, lastAliveAt: base.now - 3000}),
    'connected',
  );
});

test('a heartbeat older than the timeout drops back to not-open', () => {
  assert.equal(
    deriveCustomerDisplayConnection({...base, lastAliveAt: base.now - 8000}),
    'not-open',
  );
});

test('blocked sticks until the operator tries again or disables dual screen', () => {
  assert.equal(deriveCustomerDisplayConnection({...base, current: 'blocked'}), 'blocked');
  // …but switching dual-screen off clears it.
  assert.equal(
    deriveCustomerDisplayConnection({...base, current: 'blocked', enabled: false}),
    'off',
  );
});

test('full-screen helpers are false in an environment without a document', () => {
  // node test runner: no DOM — both must answer honestly, not throw.
  assert.equal(isFullscreenSupported(), false);
  assert.equal(isFullscreenActive(), false);
});
