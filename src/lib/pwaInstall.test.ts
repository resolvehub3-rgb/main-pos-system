import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  detectInstallPlatform,
  PLATFORM_INSTALL_GUIDES,
  resolvePwaInstallState,
} from './pwaInstall.ts';

test('resolvePwaInstallState returns installed when running in standalone mode', () => {
  assert.equal(
    resolvePwaInstallState({
      isStandalone: true,
      isInstalledConfirmed: false,
      hasDeferredPrompt: false,
    }),
    'installed',
  );
  assert.equal(
    resolvePwaInstallState({
      isStandalone: true,
      isInstalledConfirmed: false,
      hasDeferredPrompt: true,
    }),
    'installed',
  );
});

test('resolvePwaInstallState returns installable when beforeinstallprompt is captured', () => {
  assert.equal(
    resolvePwaInstallState({
      isStandalone: false,
      isInstalledConfirmed: false,
      hasDeferredPrompt: true,
    }),
    'installable',
  );
  // A fresh beforeinstallprompt proves the app is not currently installed
  // (e.g. user uninstalled it since last visit).
  assert.equal(
    resolvePwaInstallState({
      isStandalone: false,
      isInstalledConfirmed: true,
      hasDeferredPrompt: true,
    }),
    'installable',
  );
});

test('resolvePwaInstallState returns installed when appinstalled or related app confirmed', () => {
  assert.equal(
    resolvePwaInstallState({
      isStandalone: false,
      isInstalledConfirmed: true,
      hasDeferredPrompt: false,
    }),
    'installed',
  );
});

test('resolvePwaInstallState returns unsupported when neither installed nor promptable', () => {
  assert.equal(
    resolvePwaInstallState({
      isStandalone: false,
      isInstalledConfirmed: false,
      hasDeferredPrompt: false,
    }),
    'unsupported',
  );
});

test('detectInstallPlatform identifies Windows Chrome, Windows Edge, Android Chrome, and iOS Safari', () => {
  assert.equal(
    detectInstallPlatform(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    ),
    'chrome-windows',
  );
  assert.equal(
    detectInstallPlatform(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
    ),
    'edge-windows',
  );
  assert.equal(
    detectInstallPlatform(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    ),
    'chrome-android',
  );
  assert.equal(
    detectInstallPlatform(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    ),
    'safari-ios',
  );
  assert.equal(
    detectInstallPlatform(
      'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    ),
    'safari-ios',
  );
});

test('PLATFORM_INSTALL_GUIDES covers all four required platforms with actionable steps', () => {
  const ids = PLATFORM_INSTALL_GUIDES.map((g) => g.id);
  assert.deepEqual(ids, [
    'chrome-windows',
    'edge-windows',
    'chrome-android',
    'safari-ios',
  ]);
  for (const guide of PLATFORM_INSTALL_GUIDES) {
    assert.ok(guide.steps.length >= 3, `${guide.label} has clear steps`);
  }
});
