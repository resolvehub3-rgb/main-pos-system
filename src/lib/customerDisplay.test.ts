import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCustomerDisplayState, cartToCustomerItems, hasActiveSale} from './customerDisplay.ts';
import type {CartItem, Product} from '../types';

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

const cartItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  product: product(),
  quantity: 2,
  discount_percent: 0,
  ...overrides,
});

test('cartToCustomerItems keeps only customer-facing fields', () => {
  const items = cartToCustomerItems([cartItem()]);
  assert.deepEqual(items, [
    {
      id: 'prod-1',
      name: 'Milk 1L',
      imageUrl: 'https://example.com/milk.png',
      unitPrice: 12.5,
      quantity: 2,
    },
  ]);
});

test('cartToCustomerItems never leaks internal product data', () => {
  const serialized = JSON.stringify(cartToCustomerItems([cartItem()]));
  for (const forbidden of ['cost_price', 'tenant_id', 'barcode', 'stock', 'sku']) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test('cartToCustomerItems handles an empty cart', () => {
  assert.deepEqual(cartToCustomerItems([]), []);
});

test('buildCustomerDisplayState carries shop name, projected lines and total', () => {
  const state = buildCustomerDisplayState('Accra Mall Supermarket', [cartItem()], 25);
  assert.equal(state.tenantName, 'Accra Mall Supermarket');
  assert.equal(state.totalAmount, 25);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].quantity, 2);
});

/* -------------------------------------------------------------------------- */
/* Frameless window close guard: never silently discard an in-progress sale.   */
/* -------------------------------------------------------------------------- */

test('hasActiveSale is true while the till holds unsold lines', () => {
  const state = buildCustomerDisplayState('Accra Mall Supermarket', [cartItem()], 25);
  assert.equal(hasActiveSale(state), true);
});

test('hasActiveSale is false for an empty cart (sale completed / cleared)', () => {
  const state = buildCustomerDisplayState('Accra Mall Supermarket', [], 0);
  assert.equal(hasActiveSale(state), false);
});

test('hasActiveSale is false before any cart was ever pushed', () => {
  // Startup / logged-out: main has no cached state yet, so closing must not
  // be blocked waiting for a push that will never arrive.
  assert.equal(hasActiveSale(null), false);
});
