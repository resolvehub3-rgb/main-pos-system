import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCart, type PersistedCartLine} from './cartPersist.ts';
import type {Product} from '../types';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'prod-1',
  tenant_id: 'tenant-1',
  name: 'Milk 1L',
  sku: 'SKU-1',
  barcode: '8998866200234',
  cost_price: 8,
  selling_price: 12.5,
  stock_quantity: 40,
  min_stock_threshold: 5,
  image_url: 'https://example.com/milk.png',
  unit: 'bottle',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const line = (overrides: Partial<PersistedCartLine> = {}): PersistedCartLine => ({
  productId: 'prod-1',
  quantity: 2,
  discountPercent: 0,
  ...overrides,
});

test('reconcileCart restores a valid line against the live product mirror', () => {
  const restored = reconcileCart([line()], [product()], 'tenant-1');
  assert.equal(restored.length, 1);
  assert.equal(restored[0].product.id, 'prod-1');
  assert.equal(restored[0].quantity, 2);
  assert.equal(restored[0].discount_percent, 0);
});

test('reconcileCart drops products that are gone, inactive or belong to another shop', () => {
  const restored = reconcileCart(
    [
      line({productId: 'prod-missing'}),
      line({productId: 'prod-inactive'}),
      line({productId: 'prod-other-shop'}),
    ],
    [
      product({id: 'prod-inactive', is_active: false}),
      product({id: 'prod-other-shop', tenant_id: 'tenant-2'}),
    ],
    'tenant-1',
  );
  assert.deepEqual(restored, []);
});

test('reconcileCart clamps quantity to the stock on hand', () => {
  const restored = reconcileCart(
    [line({quantity: 99}), line({productId: 'prod-2', quantity: 0}), line({productId: 'prod-3', quantity: 5})],
    [
      product({stock_quantity: 7}),
      product({id: 'prod-2', stock_quantity: 3}),
      product({id: 'prod-3', stock_quantity: 0}),
    ],
    'tenant-1',
  );
  // 99 → the 7 actually in stock; 0 → nothing sellable; 0 stock → dropped.
  assert.equal(restored.length, 1);
  assert.equal(restored[0].quantity, 7);
});

test('reconcileCart normalises the saved discount into 0–100', () => {
  const restored = reconcileCart(
    [line({discountPercent: 150}), line({productId: 'prod-2', discountPercent: -20})],
    [product(), product({id: 'prod-2'})],
    'tenant-1',
  );
  assert.equal(restored[0].discount_percent, 100);
  assert.equal(restored[1].discount_percent, 0);
});

test('reconcileCart tolerates malformed quantities', () => {
  const restored = reconcileCart(
    [line({quantity: Number.NaN}), line({productId: 'prod-2', quantity: 2.7})],
    [product(), product({id: 'prod-2'})],
    'tenant-1',
  );
  // NaN is dropped (nothing the cashier actually scanned), fractional → floored.
  assert.equal(restored.length, 1);
  assert.equal(restored[0].product.id, 'prod-2');
  assert.equal(restored[0].quantity, 2);
});
