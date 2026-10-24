import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSalesViewFilters,
  saveSalesViewFilters,
  ALL_SALES_VIEW_FILTERS,
} from './salesViewFilters.ts';

// ---------------------------------------------------------------------------
// localStorage / window stub
//
// The module guards on both globals being present, so it degrades to "no
// filters" under plain Node. Stubbing them here is what lets the tests exercise
// the real read/validate/write path instead of only the fallback.
// ---------------------------------------------------------------------------

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  } as Storage;
}

let storage = makeStorage();

(globalThis as { window?: unknown }).window = {};
(globalThis as { localStorage?: Storage }).localStorage = storage;

/** Fresh storage per test so one case can't leak state into the next. */
function resetStorage(): void {
  storage = makeStorage();
  (globalThis as { localStorage?: Storage }).localStorage = storage;
}

const KEY = 'samtech_sales_view_filters_v1';

// ---------------------------------------------------------------------------

test('an unknown shop starts unfiltered', () => {
  resetStorage();
  assert.deepEqual(loadSalesViewFilters('tenant-never-seen'), ALL_SALES_VIEW_FILTERS);
});

test('an empty tenant id never reads or writes storage', () => {
  resetStorage();
  assert.deepEqual(loadSalesViewFilters(''), ALL_SALES_VIEW_FILTERS);

  saveSalesViewFilters('', { month: '2026-10', cashier: 'Kwame' });
  assert.equal(storage.length, 0, 'nothing should have been written');
  assert.deepEqual(loadSalesViewFilters(''), ALL_SALES_VIEW_FILTERS);
});

test('saved filters load back for the same shop', () => {
  resetStorage();
  saveSalesViewFilters('tenant-a', { month: '2026-10', cashier: 'Kwame' });
  assert.deepEqual(loadSalesViewFilters('tenant-a'), { month: '2026-10', cashier: 'Kwame' });
});

test('each shop keeps its own filters', () => {
  resetStorage();
  saveSalesViewFilters('tenant-a', { month: '2026-10', cashier: 'Kwame' });
  saveSalesViewFilters('tenant-b', { month: '2025-03', cashier: 'Ama' });

  assert.deepEqual(loadSalesViewFilters('tenant-a'), { month: '2026-10', cashier: 'Kwame' });
  assert.deepEqual(loadSalesViewFilters('tenant-b'), { month: '2025-03', cashier: 'Ama' });
});

test('overwriting one shop leaves the other alone', () => {
  resetStorage();
  saveSalesViewFilters('tenant-a', { month: '2026-10', cashier: 'Kwame' });
  saveSalesViewFilters('tenant-b', { month: '2025-03', cashier: 'Ama' });
  saveSalesViewFilters('tenant-a', { month: 'all', cashier: 'all' });

  assert.deepEqual(loadSalesViewFilters('tenant-a'), ALL_SALES_VIEW_FILTERS);
  assert.deepEqual(loadSalesViewFilters('tenant-b'), { month: '2025-03', cashier: 'Ama' });
});

test('corrupt storage falls back to unfiltered instead of throwing', () => {
  resetStorage();
  storage.setItem(KEY, 'not json at all');

  assert.deepEqual(loadSalesViewFilters('tenant-a'), ALL_SALES_VIEW_FILTERS);

  // ...and must be recoverable: the next save writes a valid record again.
  saveSalesViewFilters('tenant-a', { month: '2026-10', cashier: 'Kwame' });
  assert.deepEqual(loadSalesViewFilters('tenant-a'), { month: '2026-10', cashier: 'Kwame' });
});

test('a non-object payload is ignored', () => {
  for (const payload of ['"tenant-a"', '[]', 'null', '17']) {
    resetStorage();
    storage.setItem(KEY, payload);
    assert.deepEqual(
      loadSalesViewFilters('tenant-a'),
      ALL_SALES_VIEW_FILTERS,
      `payload ${payload} should be ignored`,
    );
  }
});

test('a malformed month falls back to all', () => {
  resetStorage();
  for (const month of ['2026-13', '2026-00', 'October', '2026-1', 202610, null, undefined]) {
    storage.setItem(KEY, JSON.stringify({ 'tenant-a': { month, cashier: 'Kwame' } }));
    assert.equal(loadSalesViewFilters('tenant-a').month, 'all', `month ${String(month)} rejected`);
  }
});

test('a valid month survives, including a zero-padded one', () => {
  resetStorage();
  for (const month of ['all', '2026-10', '2025-01', '2024-12']) {
    storage.setItem(KEY, JSON.stringify({ 'tenant-a': { month, cashier: 'all' } }));
    assert.equal(loadSalesViewFilters('tenant-a').month, month);
  }
});

test('a non-string or absurdly long cashier falls back to all', () => {
  resetStorage();
  for (const cashier of [123, null, undefined, {}, '', 'x'.repeat(201)]) {
    storage.setItem(KEY, JSON.stringify({ 'tenant-a': { month: '2026-10', cashier } }));
    assert.equal(
      loadSalesViewFilters('tenant-a').cashier,
      'all',
      `cashier ${String(cashier).slice(0, 20)} rejected`,
    );
  }
});

test('filters stored under a different shape are rebuilt with defaults', () => {
  resetStorage();
  storage.setItem(KEY, JSON.stringify({ 'tenant-a': '2026-10' }));

  assert.deepEqual(loadSalesViewFilters('tenant-a'), ALL_SALES_VIEW_FILTERS);
});

test('writing while storage is unavailable does not throw', () => {
  const original = (globalThis as { localStorage?: Storage }).localStorage;
  try {
    // Private mode / quota exceeded: the setter may exist but reject writes.
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;

    assert.doesNotThrow(() =>
      saveSalesViewFilters('tenant-a', { month: '2026-10', cashier: 'Kwame' }),
    );
  } finally {
    (globalThis as { localStorage?: Storage }).localStorage = original;
  }
});
