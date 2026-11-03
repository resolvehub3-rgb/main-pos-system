import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCustomerDisplayState, cartToCustomerItems} from './customerDisplay.ts';
import {calculateCartTotals} from './money.ts';
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

const totalsFor = (items: CartItem[]) =>
  calculateCartTotals(
    items.map((c) => ({
      price: c.product.selling_price,
      quantity: c.quantity,
      discountPercent: c.discount_percent,
    })),
  );

test('cartToCustomerItems keeps only customer-facing fields', () => {
  const items = cartToCustomerItems([cartItem()]);
  assert.deepEqual(items, [
    {
      id: 'prod-1',
      name: 'Milk 1L',
      imageUrl: 'https://example.com/milk.png',
      unitPrice: 12.5,
      quantity: 2,
      lineTotal: 25,
      discountPercent: 0,
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

test('cartToCustomerItems applies the line discount to the line total', () => {
  const [item] = cartToCustomerItems([cartItem({discount_percent: 10})]);
  assert.equal(item.discountPercent, 10);
  // 12.50 × 2 = 25.00 less 10% → 22.50, rounded like the till rounds it.
  assert.equal(item.lineTotal, 22.5);
});

test('buildCustomerDisplayState carries shop name, projected lines and totals', () => {
  const cart = [cartItem()];
  const state = buildCustomerDisplayState('Accra Mall Supermarket', cart, totalsFor(cart));
  assert.equal(state.tenantName, 'Accra Mall Supermarket');
  assert.equal(state.subtotal, 25);
  assert.equal(state.discountTotal, 0);
  assert.equal(state.taxTotal, 0);
  assert.equal(state.totalAmount, 25);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].quantity, 2);
});

test('buildCustomerDisplayState reports discounts exactly like the till panel', () => {
  const cart = [cartItem({discount_percent: 10})];
  const state = buildCustomerDisplayState('Zen Mart', cart, totalsFor(cart));
  assert.equal(state.subtotal, 25);
  assert.equal(state.discountTotal, 2.5);
  assert.equal(state.taxTotal, 0);
  assert.equal(state.totalAmount, 22.5);
});

test('buildCustomerDisplayState for an empty cart projects no lines', () => {
  const state = buildCustomerDisplayState('', [], calculateCartTotals([]));
  assert.deepEqual(state.items, []);
  assert.equal(state.subtotal, 0);
  assert.equal(state.totalAmount, 0);
  assert.equal('payment' in state, false);
});

test('buildCustomerDisplayState carries the shop photo to the customer screen', () => {
  const logo = 'data:image/jpeg;base64,dGVzdA==';
  assert.equal(
    buildCustomerDisplayState('Zen Mart', [], calculateCartTotals([]), logo).tenantLogo,
    logo,
  );

  // No photo → the key is absent rather than an empty string, so the display
  // keeps its branded placeholder instead of rendering a broken <img>.
  const plain = buildCustomerDisplayState('Zen Mart', [], calculateCartTotals([]));
  assert.equal('tenantLogo' in plain, false);
  assert.equal(
    buildCustomerDisplayState('Zen Mart', [], calculateCartTotals([]), '').tenantLogo,
    undefined,
  );

  // The projection still leaks nothing internal — the logo is the only tenant
  // field that crosses the channel alongside the name.
  const serialized = JSON.stringify(plain);
  for (const forbidden of ['cost_price', 'tenant_id', 'barcode', 'logo_url']) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test('buildCustomerDisplayState carries a payment confirmation and nothing else internal', () => {
  const state = buildCustomerDisplayState('Zen Mart', [], calculateCartTotals([]), undefined, {
    method: 'cash',
    amount: 50,
    changeDue: 2.5,
    paidAt: '2026-11-02T10:00:00.000Z',
  });
  assert.equal(state.payment?.method, 'cash');
  assert.equal(state.payment?.amount, 50);
  assert.equal(state.payment?.changeDue, 2.5);

  const serialized = JSON.stringify(state);
  for (const forbidden of ['cost_price', 'tenant_id', 'barcode', 'pin', 'password']) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});
