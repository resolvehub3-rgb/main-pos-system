import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {
  applyStandaloneTitle,
  detectInstallPlatform,
  isStandalone,
  resolveInstallState,
} from './pwa.ts';

interface StubGlobals {
  restore(): void;
}

function stubWindow(matched: boolean): StubGlobals {
  const g = globalThis as Record<string, unknown>;
  const hadWindow = 'window' in g;
  const hadDocument = 'document' in g;
  const prevWindow = g.window;
  const prevDocument = g.document;

  g.window = {
    matchMedia: (query: string) => ({matches: matched && query.includes('standalone')}),
    navigator: {},
  };
  g.document = {title: 'SamTill — Supermarket & Retail POS for Ghana | SamTeck Digital'};

  return {
    restore() {
      if (hadWindow) g.window = prevWindow;
      else delete g.window;
      if (hadDocument) g.document = prevDocument;
      else delete g.document;
    },
  };
}

test('isStandalone is false in a normal browser tab', () => {
  const stub = stubWindow(false);
  try {
    assert.equal(isStandalone(), false);
  } finally {
    stub.restore();
  }
});

test('isStandalone is true in the installed app window', () => {
  const stub = stubWindow(true);
  try {
    assert.equal(isStandalone(), true);
  } finally {
    stub.restore();
  }
});

test('applyStandaloneTitle leaves the SEO title alone in a browser tab', () => {
  const stub = stubWindow(false);
  try {
    applyStandaloneTitle();
    assert.equal(
      (globalThis as Record<string, any>).document.title,
      'SamTill — Supermarket & Retail POS for Ghana | SamTeck Digital',
      'a normal tab must keep its SEO title',
    );
  } finally {
    stub.restore();
  }
});

test('applyStandaloneTitle shortens the title in the installed window', () => {
  const stub = stubWindow(true);
  try {
    applyStandaloneTitle();
    assert.equal((globalThis as Record<string, any>).document.title, 'SamTill POS');
  } finally {
    stub.restore();
  }
});

test('applyStandaloneTitle is a no-op without a document (SSR / Node)', () => {
  assert.doesNotThrow(() => applyStandaloneTitle());
});

test('resolveInstallState selects installed, installable, or unsupported honestly', () => {
  assert.equal(
    resolveInstallState({
      standalone: true,
      relatedInstalled: false,
      appInstalledRecorded: false,
      hasPromptEvent: false,
    }),
    'installed',
  );
  assert.equal(
    resolveInstallState({
      standalone: false,
      relatedInstalled: true,
      appInstalledRecorded: false,
      hasPromptEvent: false,
    }),
    'installed',
  );
  assert.equal(
    resolveInstallState({
      standalone: false,
      relatedInstalled: false,
      appInstalledRecorded: true,
      hasPromptEvent: false,
    }),
    'installed',
  );
  assert.equal(
    resolveInstallState({
      standalone: false,
      relatedInstalled: false,
      appInstalledRecorded: false,
      hasPromptEvent: true,
    }),
    'installable',
  );
  assert.equal(
    resolveInstallState({
      standalone: false,
      relatedInstalled: false,
      appInstalledRecorded: false,
      hasPromptEvent: false,
    }),
    'unsupported',
  );
});

test('detectInstallPlatform identifies iOS, Android, Edge, and Chrome Windows', () => {
  assert.equal(detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'safari-ios');
  assert.equal(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0'), 'chrome-android');
  assert.equal(detectInstallPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/121.0'), 'edge-windows');
  assert.equal(detectInstallPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0'), 'chrome-windows');
});
