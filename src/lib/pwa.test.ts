import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {applyStandaloneTitle, isStandalone} from './pwa.ts';

/**
 * PWA window-title tests.
 *
 * The installed PWA's title bar renders `document.title`, which is the long
 * SEO <title> from index.html. applyStandaloneTitle() swaps it for the short
 * app name — but ONLY when actually running installed, so a normal browser
 * tab (and its SEO title) is never touched. These tests run in Node (no real
 * window/document), so the browser globals are stubbed per test and restored
 * afterwards.
 */

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
    // isStandalone() reads window.navigator.standalone as a fallback — the
    // stub must not blow up when matchMedia does not match.
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
  // No globals stubbed — must not throw.
  assert.doesNotThrow(() => applyStandaloneTitle());
});
