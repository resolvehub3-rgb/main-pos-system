import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adoptBranch,
  adoptCategory,
  adoptCustomer,
  adoptProduct,
  adoptSale,
  adoptTenant,
  adoptUser,
} from './mirrorRows.ts';

/**
 * The shape a row actually has once it has travelled: `productRow` writes
 * NULL for the blanks, `saleRow` drops `sale_id` from each item, and a couple
 * of columns can arrive holding something the union types do not know about.
 */
const rawProduct = {
  id: '5f4dcc3b-5aa7-4f1b-9c8d-0e1a2b3c4d5e',
  tenant_id: '6f9619ff-8b86-4f01-b42d-00c04fc964ff',
  category_id: null,
  category_name: null,
  name: 'Peak Milk Powder 400g',
  sku: null,
  barcode: '6034000100123',
  cost_price: 41,
  avg_cost: null,
  selling_price: 48,
  stock_quantity: 12,
  min_stock_threshold: 3,
  image_url: null,
  unit: null,
  is_active: true,
  created_at: '2026-10-20T09:15:00.000Z',
};

test('adoptProduct turns the mirror NULLs back into strings the till can use', () => {
  const product = adoptProduct(rawProduct);

  // CashierPOS searches with `p.sku.toLowerCase()` — a null here would throw
  // and take the whole checkout grid down with it.
  assert.equal(product.sku.toLowerCase(), '');
  assert.equal(product.unit, '');
  assert.equal(product.image_url, '');
  assert.equal(product.name, 'Peak Milk Powder 400g');
  assert.equal(product.category_id, undefined);
  assert.equal(product.category_name, undefined);
  assert.equal(product.avg_cost, undefined);
  assert.equal(product.is_active, true);
});

test('adoptProduct keeps a product hidden when the mirror says it is inactive', () => {
  assert.equal(adoptProduct({ ...rawProduct, is_active: false }).is_active, false);
  // A row written before the column existed reads as active, not hidden.
  const withoutFlag = { ...rawProduct };
  delete (withoutFlag as Record<string, unknown>).is_active;
  assert.equal(adoptProduct(withoutFlag).is_active, true);
});

test('adoptProduct defaults missing numbers instead of yielding NaN', () => {
  const product = adoptProduct({ id: 'p1', tenant_id: 't1', name: 'Bread', selling_price: null });

  assert.equal(product.selling_price, 0);
  assert.equal(product.cost_price, 0);
  assert.equal(product.stock_quantity, 0);
  assert.equal(product.min_stock_threshold, 0);
  assert.equal(product.is_active, true);
});

test('adoptCategory keeps the optional fields out of the way when they are null', () => {
  const category = adoptCategory({
    id: 'c1',
    tenant_id: 't1',
    name: 'Dairy',
    description: null,
    color: null,
    parent_id: null,
    is_active: true,
    deactivated_at: null,
    deactivated_by: null,
    created_at: '2026-10-20T09:15:00.000Z',
  });

  assert.equal(category.description, undefined);
  assert.equal(category.color, undefined);
  assert.equal(category.parent_id, undefined);
  assert.equal(category.deactivated_at, undefined);
  assert.equal(category.deactivated_by, undefined);
  assert.equal(category.is_active, true);
});

test('adoptCustomer normalises a blank phone to an empty string', () => {
  const customer = adoptCustomer({
    id: 'cu1',
    tenant_id: 't1',
    name: 'Ama Mensah',
    phone: null,
    email: null,
    loyalty_points: 40,
    total_spent: 312.5,
    created_at: '2026-10-20T09:15:00.000Z',
  });

  assert.equal(customer.phone, '');
  assert.equal(customer.email, undefined);
  assert.equal(customer.loyalty_points, 40);
  assert.equal(customer.total_spent, 312.5);
});

test('adoptSale restores sale_id on every item from the parent row', () => {
  const sale = adoptSale({
    id: 's1',
    tenant_id: 't1',
    branch_id: 'b1',
    register_id: null,
    cashier_id: 'u9',
    cashier_name: 'Kofi Boateng',
    shop_name: 'Zen Shop Mart',
    customer_name: null,
    invoice_number: 'INV-004210',
    subtotal: 100,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 100,
    cost_amount: 82,
    payment_method: 'mobile_money',
    payment_details: { momo_network: 'MTN', momo_reference: 'MP261020.1422' },
    status: 'completed',
    created_at: '2026-10-20T09:15:00.000Z',
    items: [
      {
        id: 'i1',
        product_id: 'p1',
        product_name: 'Peak Milk Powder 400g',
        barcode: '6034000100123',
        unit_price: 48,
        cost_price: 41,
        quantity: 2,
        discount_amount: 0,
        tax_amount: 0,
        total_amount: 96,
      },
      null,
    ],
  });

  assert.equal(sale.items.length, 2);
  assert.equal(sale.items[0].sale_id, 's1');
  // A malformed item must not throw while a receipt is being reprinted.
  assert.equal(sale.items[1].sale_id, 's1');
  assert.equal(sale.items[1].quantity, 0);
  assert.equal(sale.cashier_name, 'Kofi Boateng');
  assert.equal(sale.customer_name, undefined);
  assert.equal(sale.payment_details?.momo_network, 'MTN');
  assert.equal(sale.payment_method, 'mobile_money');
  assert.equal(sale.status, 'completed');
});

test('adoptSale falls back for a payment method and status the union types do not know', () => {
  const sale = adoptSale({
    id: 's2',
    tenant_id: 't1',
    branch_id: 'b1',
    cashier_id: 'u9',
    invoice_number: 'INV-004211',
    payment_method: 'voucher_2019',
    payment_details: 'corrupt',
    status: 'pending_review',
    items: [],
  });

  assert.equal(sale.payment_method, 'other');
  assert.equal(sale.payment_details, undefined);
  assert.equal(sale.status, 'completed');
});

test('adoptSale survives a row with no items array at all', () => {
  const sale = adoptSale({ id: 's3', tenant_id: 't1', branch_id: 'b1' });

  assert.deepEqual(sale.items, []);
  assert.equal(sale.invoice_number, '');
  assert.equal(sale.total_amount, 0);
});

test('adoptTenant maps the schema-only subscription state onto the union', () => {
  const base = {
    id: 't1',
    name: 'Zen Shop Mart',
    slug: 'zen-shop-mart',
    logo_url: null,
    phone: '+233 24 000 0000',
    email: 'hello@zenshop.com',
    address: 'Spintex Road, Accra',
    tax_number: null,
    currency: 'GHS',
    is_active: true,
    subscription_status: 'active',
    created_at: '2026-10-20T09:15:00.000Z',
  };

  const active = adoptTenant(base);
  assert.equal(active.currency, 'GHS');
  assert.equal(active.logo_url, undefined);
  assert.equal(active.tax_number, undefined);
  assert.equal(active.subscription_status, 'active');

  // `cancelled` passes the database CHECK but is not in the app's union —
  // it must read as a non-paying shop, never as an unknown literal.
  assert.equal(adoptTenant({ ...base, subscription_status: 'cancelled' }).subscription_status, 'suspended');
  assert.equal(adoptTenant({ ...base, subscription_status: null }).subscription_status, 'suspended');
  // Absent flag reads as an operating shop, like every other adopter here.
  assert.equal(adoptTenant({ ...base, is_active: null }).is_active, true);
  assert.equal(adoptTenant({ ...base, is_active: false }).is_active, false);
});

test('adoptTenant keeps an unedited receipt footer apart from a cleared one', () => {
  const row = { id: 't1', name: 'Zen Shop Mart', slug: 'zen-shop-mart' };

  // The column is NULL on a shop that never opened Store Settings: the app
  // must fall back to its built-in note, so this has to read as `undefined`.
  assert.equal(adoptTenant({ ...row, receipt_footer: null }).receipt_footer, undefined);
  assert.equal(adoptTenant(row).receipt_footer, undefined);

  // Cleared by the owner: an explicit empty string must survive, otherwise the
  // default note would print again after they removed it.
  assert.equal(adoptTenant({ ...row, receipt_footer: '' }).receipt_footer, '');

  // And the text they typed comes back verbatim — this is what every open
  // till renders once the realtime payload folds in.
  assert.equal(
    adoptTenant({ ...row, receipt_footer: 'Goods returnable within 48h.' }).receipt_footer,
    'Goods returnable within 48h.',
  );
});

test('adoptBranch defaults the flags the way the till expects', () => {
  const branch = adoptBranch({
    id: 'b1',
    tenant_id: 't1',
    name: 'Main Branch',
    code: 'MAIN',
    address: 'Oxford Street, Osu',
    phone: null,
    is_main: null,
    is_active: null,
  });

  assert.equal(branch.phone, undefined);
  assert.equal(branch.is_main, false);
  assert.equal(branch.is_active, true);
});

test('adoptUser never restores credentials and coerces an unknown role', () => {
  const roster = adoptUser({
    id: 'u1',
    tenant_id: null,
    shop_name: null,
    full_name: 'Kofi Boateng',
    email: 'kofi@example.com',
    role: 'shop_owner',
    phone: '+233 24 111 2222',
    is_active: true,
    created_at: '2026-10-20T09:15:00.000Z',
  });

  // A super-admin's own roster row is the platform-level shape: no tenant.
  assert.equal(roster.tenant_id, undefined);
  assert.equal(roster.shop_name, undefined);
  assert.equal(roster.role, 'shop_owner');
  // Credentials are never mirrored, so an adopted row can carry none.
  assert.equal(roster.password, undefined);
  assert.equal(roster.pin, undefined);

  // Unrecognised role → least privilege; it must never read as authority.
  assert.equal(adoptUser({ id: 'u2', full_name: 'X', email: 'x@y.z', role: 'root' }).role, 'cashier');
});
