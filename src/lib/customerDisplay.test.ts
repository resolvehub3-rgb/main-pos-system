import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCustomerDisplayState, cartToCustomerItems} from './customerDisplay.ts';
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

test('buildCustomerDisplayState for an empty cart projects no lines', () => {
  const state = buildCustomerDisplayState('', [], 0);
  assert.deepEqual(state.items, []);
  assert.equal(state.totalAmount, 0);
});

test('buildCustomerDisplayState carries the shop photo to the customer screen', () => {
  const logo = 'data:image/jpeg;base64,dGVzdA==';
  assert.equal(buildCustomerDisplayState('Zen Mart', [], 0, logo).tenantLogo, logo);

  // No photo → the key is absent rather than an empty string, so the display
  // keeps its branded placeholder instead of rendering a broken <img>.
  const plain = buildCustomerDisplayState('Zen Mart', [], 0);
  assert.equal('tenantLogo' in plain, false);
  assert.equal(buildCustomerDisplayState('Zen Mart', [], 0, '').tenantLogo, undefined);

  // The projection still leaks nothing internal — the logo is the only tenant
  // field that crosses the channel alongside the name.
  const serialized = JSON.stringify(plain);
  for (const forbidden of ['cost_price', 'tenant_id', 'barcode', 'logo_url']) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});
