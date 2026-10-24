import test from 'node:test';
import assert from 'node:assert/strict';
import {
  movementDelta,
  weightedAverageOnReceipt,
  effectiveUnitCost,
  buildStockBook,
  estimateStockDays,
  dayRange,
  addDays,
} from './stockBook.ts';
import type { InventoryMovement, Product, ProductCategory } from '../types/index.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeProduct = (over: Partial<Product> = {}): Product => ({
  id: 'prod-1',
  tenant_id: 'tenant-a',
  category_id: 'cat-water',
  name: 'Bottled Water 1.5L',
  sku: 'WAT-001',
  barcode: '6001112223334',
  cost_price: 2,
  avg_cost: 2,
  selling_price: 3,
  stock_quantity: 0,
  min_stock_threshold: 5,
  image_url: '',
  unit: 'Bottle',
  is_active: true,
  created_at: '2026-10-01T08:00:00.000Z',
  ...over,
});

const makeMov = (over: Partial<InventoryMovement>): InventoryMovement => ({
  id: `mov-${Math.random()}`,
  tenant_id: 'tenant-a',
  branch_id: 'branch-main',
  product_id: 'prod-1',
  product_name: 'Bottled Water 1.5L',
  type: 'restock',
  quantity: 1,
  created_at: '2026-10-01T09:00:00.000Z',
  ...over,
});

const categories: ProductCategory[] = [
  {
    id: 'cat-water',
    tenant_id: 'tenant-a',
    name: 'Water',
    is_active: true,
    created_at: '2026-10-01T00:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// Movement classification
// ---------------------------------------------------------------------------

test('movementDelta classifies in, out and signed movement types', () => {
  assert.equal(movementDelta({ type: 'restock', quantity: 10 }), 10);
  assert.equal(movementDelta({ type: 'opening_stock', quantity: 5 }), 5);
  assert.equal(movementDelta({ type: 'customer_return', quantity: 2 }), 2);
  assert.equal(movementDelta({ type: 'refund', quantity: 3 }), 3);
  assert.equal(movementDelta({ type: 'transfer_in', quantity: 4 }), 4);
  assert.equal(movementDelta({ type: 'sale', quantity: 7 }), -7);
  assert.equal(movementDelta({ type: 'damage', quantity: 2 }), -2);
  assert.equal(movementDelta({ type: 'expired', quantity: 1 }), -1);
  assert.equal(movementDelta({ type: 'supplier_return', quantity: 6 }), -6);
  assert.equal(movementDelta({ type: 'transfer_out', quantity: 9 }), -9);
  assert.equal(movementDelta({ type: 'adjustment', quantity: -3 }), -3);
  assert.equal(movementDelta({ type: 'adjustment', quantity: 4 }), 4);
  assert.equal(movementDelta({ type: 'reversal', quantity: -5 }), -5);
});

// ---------------------------------------------------------------------------
// Weighted-average cost
// ---------------------------------------------------------------------------

test('weightedAverageOnReceipt blends existing value with the new receipt', () => {
  // 20 @ 2.00 + 10 @ 3.00 => 70 / 30 = 2.3333
  const avg = weightedAverageOnReceipt(20, 2, 10, 3);
  assert.ok(Math.abs(avg - 70 / 30) < 1e-9, `unexpected avg ${avg}`);
});

test('weightedAverageOnReceipt handles zero existing stock', () => {
  assert.equal(weightedAverageOnReceipt(0, 5, 25, 1.6), 1.6);
});

test('weightedAverageOnReceipt keeps previous average for zero-quantity receipts', () => {
  assert.equal(weightedAverageOnReceipt(12, 4.25, 0, 99), 4.25);
});

test('effectiveUnitCost prefers weighted-average cost, falls back to cost price', () => {
  assert.equal(effectiveUnitCost({ avg_cost: 2.5, cost_price: 3 }), 2.5);
  assert.equal(effectiveUnitCost({ avg_cost: 0, cost_price: 3 }), 3);
  assert.equal(effectiveUnitCost({ cost_price: 3 }), 3);
});

// ---------------------------------------------------------------------------
// Day helpers
// ---------------------------------------------------------------------------

test('dayRange and addDays produce inclusive business-day sequences', () => {
  assert.deepEqual(dayRange('2026-10-01', '2026-10-03'), [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
  ]);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

// ---------------------------------------------------------------------------
// Stock Book
// ---------------------------------------------------------------------------

test('buildStockBook reconciles opening, received, sales and closing per day', () => {
  const product = makeProduct({ stock_quantity: 115 });
  const movements: InventoryMovement[] = [
    makeMov({ type: 'opening_stock', quantity: 100, created_at: '2026-10-01T08:00:00Z' }),
    makeMov({ type: 'sale', quantity: 10, created_at: '2026-10-01T10:00:00Z' }),
    makeMov({ type: 'restock', quantity: 50, unit_cost: 2, created_at: '2026-10-02T09:00:00Z' }),
    makeMov({ type: 'sale', quantity: 15, created_at: '2026-10-02T15:00:00Z' }),
    makeMov({ type: 'damage', quantity: 5, created_at: '2026-10-02T16:00:00Z' }),
    makeMov({ type: 'sale', quantity: 5, created_at: '2026-10-03T11:00:00Z' }),
  ];

  const book = buildStockBook({
    products: [product],
    movements,
    categories,
    from: '2026-10-01',
    to: '2026-10-03',
  });

  assert.equal(book.entries.length, 1);
  const entry = book.entries[0];
  assert.equal(entry.category?.name, 'Water');
  assert.equal(entry.days.length, 3);

  const [d1, d2, d3] = entry.days;
  // Day 1: open 0 + opening 100, sold 10
  assert.equal(d1.opening, 0);
  assert.equal(d1.received, 100);
  assert.equal(d1.total, 100);
  assert.equal(d1.sold, 10);
  assert.equal(d1.closing, 90);
  // Day 2: open 90 + 50 received, sold 15, 5 damaged
  assert.equal(d2.opening, 90);
  assert.equal(d2.received, 50);
  assert.equal(d2.total, 140);
  assert.equal(d2.sold, 15);
  assert.equal(d2.otherOut, 5);
  assert.equal(d2.closing, 120);
  // Day 3
  assert.equal(d3.opening, 120);
  assert.equal(d3.sold, 5);
  assert.equal(d3.closing, 115);

  // Closing balance must reconcile with the ledger-derived live stock
  assert.equal(entry.reconciles, true);
  assert.equal(entry.currentStock, 115);
  // Value at weighted-average cost
  assert.equal(entry.unitCost, 2);
  assert.ok(Math.abs(entry.currentValueAtCost - 230) < 1e-9);
});

test('buildStockBook windows opening balance from earlier history', () => {
  const product = makeProduct({ stock_quantity: 30 });
  const movements: InventoryMovement[] = [
    makeMov({ type: 'opening_stock', quantity: 100, created_at: '2026-09-25T08:00:00Z' }),
    makeMov({ type: 'sale', quantity: 60, created_at: '2026-09-28T10:00:00Z' }),
    makeMov({ type: 'sale', quantity: 10, created_at: '2026-10-02T10:00:00Z' }),
  ];

  const book = buildStockBook({
    products: [product],
    movements,
    categories,
    from: '2026-10-01',
    to: '2026-10-02',
  });

  const entry = book.entries[0];
  assert.equal(entry.days[0].opening, 40); // 100 - 60 recorded before the window
  assert.equal(entry.days[0].closing, 40); // no movement on Oct 1
  assert.equal(entry.days[1].opening, 40);
  assert.equal(entry.days[1].closing, 30); // 10 sold on Oct 2
  assert.equal(entry.reconciles, true);
});

test('buildStockBook never fabricates history for products without movements', () => {
  const product = makeProduct({ stock_quantity: 12 });
  const book = buildStockBook({
    products: [product],
    movements: [],
    categories,
    from: '2026-10-01',
    to: '2026-10-03',
  });

  const entry = book.entries[0];
  assert.equal(entry.days.length, 0);
  assert.equal(entry.reliableFrom, null);
  assert.ok(entry.historyNote && entry.historyNote.includes('No stock movement history'));
  assert.equal(entry.currentStock, 12);
});

test('buildStockBook marks unverifiable earlier days when tracking starts mid-window', () => {
  const product = makeProduct({ stock_quantity: 10 });
  const movements: InventoryMovement[] = [
    makeMov({ type: 'opening_stock', quantity: 10, created_at: '2026-10-03T08:00:00Z' }),
  ];

  const book = buildStockBook({
    products: [product],
    movements,
    categories,
    from: '2026-10-01',
    to: '2026-10-05',
  });

  const entry = book.entries[0];
  assert.equal(entry.reliableFrom, '2026-10-03');
  assert.ok(entry.historyNote && entry.historyNote.includes('2026-10-03'));
  // Rows only from tracking start — no invented rows for Oct 1-2
  assert.equal(entry.days.length, 3);
  assert.equal(entry.days[0].date, '2026-10-03');
});

test('buildStockBook filters by category', () => {
  const products = [
    makeProduct({ id: 'p1', category_id: 'cat-water' }),
    makeProduct({ id: 'p2', name: 'Soap', category_id: 'cat-other' }),
  ];
  const book = buildStockBook({
    products,
    movements: [],
    categories,
    from: '2026-10-01',
    to: '2026-10-01',
    categoryId: 'cat-water',
  });
  assert.equal(book.entries.length, 1);
  assert.equal(book.entries[0].product.id, 'p1');
});

// ---------------------------------------------------------------------------
// 30-day stock-days estimate
// ---------------------------------------------------------------------------

test('estimateStockDays returns no_sales without fabricating an estimate', () => {
  const product = makeProduct({ stock_quantity: 40, created_at: '2026-01-01T00:00:00Z' });
  const movements = [makeMov({ type: 'opening_stock', quantity: 40, created_at: '2026-01-01T08:00:00Z' })];
  const est = estimateStockDays(product, movements, new Date('2026-10-03T12:00:00Z'));
  assert.equal(est.available, false);
  assert.equal(est.days, null);
  assert.equal(est.reason, 'no_sales');
  assert.equal(est.preliminary, false);
});

test('estimateStockDays returns no_history for products with no movements', () => {
  const est = estimateStockDays(makeProduct(), [], new Date('2026-10-03T12:00:00Z'));
  assert.equal(est.available, false);
  assert.equal(est.reason, 'no_history');
  assert.equal(est.days, null);
});

test('estimateStockDays computes stock ÷ (net sold in 30 days ÷ 30)', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const product = makeProduct({ stock_quantity: 30, created_at: '2026-08-01T00:00:00Z' });
  const movements = [
    makeMov({ type: 'opening_stock', quantity: 100, created_at: '2026-08-01T08:00:00Z' }),
    makeMov({ type: 'sale', quantity: 10, created_at: '2026-09-20T10:00:00Z' }),
    makeMov({ type: 'sale', quantity: 20, created_at: '2026-10-01T10:00:00Z' }),
  ];
  const est = estimateStockDays(product, movements, now);
  assert.equal(est.available, true);
  assert.equal(est.netSold30d, 30);
  assert.ok(Math.abs((est.avgDailySales ?? 0) - 1) < 1e-9);
  assert.ok(Math.abs((est.days ?? 0) - 30) < 0.05);
  assert.equal(est.preliminary, false);
});

test('estimateStockDays nets off refunds that returned stock to sellable inventory', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const product = makeProduct({ stock_quantity: 50, created_at: '2026-08-01T00:00:00Z' });
  const movements = [
    makeMov({ type: 'opening_stock', quantity: 100, created_at: '2026-08-01T08:00:00Z' }),
    makeMov({ type: 'sale', quantity: 40, created_at: '2026-10-01T10:00:00Z' }),
    makeMov({ type: 'refund', quantity: 10, created_at: '2026-10-02T10:00:00Z' }),
  ];
  const est = estimateStockDays(product, movements, now);
  assert.equal(est.netSold30d, 30); // 40 sold − 10 returned
});

test('estimateStockDays flags preliminary estimates for short history', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const product = makeProduct({ stock_quantity: 5, created_at: '2026-10-01T00:00:00Z' });
  const movements = [
    makeMov({ type: 'opening_stock', quantity: 10, created_at: '2026-10-01T08:00:00Z' }),
    makeMov({ type: 'sale', quantity: 5, created_at: '2026-10-02T10:00:00Z' }),
  ];
  const est = estimateStockDays(product, movements, now);
  assert.equal(est.available, true);
  assert.equal(est.preliminary, true);
  assert.ok(est.message && est.message.includes('Preliminary'));
});
