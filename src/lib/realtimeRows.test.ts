import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyRealtimeRow } from './realtimeRows.ts';
import { adoptSale, adoptUser } from './mirrorRows.ts';
import { fromUuid, toUuid } from './sync.ts';
import type { Sale, UserAccount } from '../types/index.ts';

/**
 * These are the payloads Supabase actually sends: an INSERT/UPDATE carries
 * the row in `new`, a DELETE carries only `old` (the id). The id is always
 * the database UUID — the app id a row was created under arrives only after
 * `resolveEchoId` maps it back.
 */
const serverSale = {
  id: '11111111-2222-4333-8444-555555555555',
  tenant_id: '99999999-8888-4777-8666-555555555555',
  branch_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  cashier_id: 'ffffffff-0000-4111-8222-333333333333',
  cashier_name: 'Kofi Boateng',
  shop_name: 'Zen Shop Mart',
  invoice_number: 'INV-004210',
  subtotal: 100,
  discount_amount: 0,
  tax_amount: 0,
  total_amount: 100,
  cost_amount: 82,
  payment_method: 'cash',
  status: 'refunded',
  created_at: '2026-10-20T09:15:00.000Z',
  items: [
    {
      id: 'aaaaaaaa-0000-4111-8222-333333333333',
      product_id: 'bbbbbbbb-0000-4111-8222-333333333333',
      product_name: 'Peak Milk Powder 400g',
      unit_price: 48,
      cost_price: 41,
      quantity: 2,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: 96,
    },
  ],
};

const heldSale = (): Sale => ({
  ...adoptSale({ ...serverSale, status: 'completed' }),
  id: 'sale-1761000000000-abc1',
});

test('a sale created on another till is adopted instead of dropped', () => {
  const store: Sale[] = [];

  const changed = applyRealtimeRow(store, 'INSERT', null, serverSale, adoptSale);

  assert.equal(changed, true);
  assert.equal(store.length, 1);
  assert.equal(store[0].invoice_number, 'INV-004210');
  // The row is claimed, so the NEXT event for it resolves to this row
  // instead of arriving as an unknown id and being adopted twice.
  assert.equal(fromUuid(store[0].id), store[0].id);
  assert.equal(applyRealtimeRow(store, 'INSERT', serverSale.id, serverSale, adoptSale), false);
  assert.equal(store.length, 1);
});

test("an echo of this tab's own sale is recognised and skipped", () => {
  const sale = heldSale();
  const store: Sale[] = [sale];
  // What `resolveEchoId` hands over for our own write: the app id.
  const resolved = fromUuid(toUuid(sale.id));
  assert.equal(resolved, sale.id);

  const changed = applyRealtimeRow(store, 'INSERT', resolved, serverSale, adoptSale);

  assert.equal(changed, false);
  assert.equal(store.length, 1);
  assert.equal(store[0], sale);
});

test('a refund from another session rebuilds the receipt lines correctly', () => {
  const sale = heldSale();
  const store: Sale[] = [sale];

  const changed = applyRealtimeRow(store, 'UPDATE', sale.id, serverSale, adoptSale);

  assert.equal(changed, true);
  assert.equal(store[0].status, 'refunded'); // server truth wins
  assert.equal(store[0].id, sale.id); // still keyed the way this device holds it
  // The JSON snapshot arrives WITHOUT sale_id — only the normaliser puts it
  // back, which is why the fold must not spread raw columns over the row.
  assert.equal(store[0].items[0].sale_id, sale.id);
});

test('app-only fields survive a server update', () => {
  const cashier: UserAccount = {
    id: 'user-1761000000000-abc1',
    tenant_id: 'tenant-1',
    full_name: 'Ama Mensah',
    email: 'ama@example.com',
    role: 'cashier',
    phone: '+233 24 111 2222',
    password: 'device-local-secret',
    is_active: true,
    created_at: '2026-10-20T09:15:00.000Z',
  };
  const store: UserAccount[] = [cashier];

  // A status toggle from the owner's phone. Credentials are never mirrored,
  // so they are absent from the payload and must not be wiped by it.
  const changed = applyRealtimeRow(
    store,
    'UPDATE',
    cashier.id,
    { id: '55555555-6666-4777-8888-999999999999', email: 'ama@example.com', role: 'cashier', is_active: false },
    adoptUser,
  );

  assert.equal(changed, true);
  assert.equal(store[0].is_active, false);
  assert.equal(store[0].password, 'device-local-secret');
});

test('a deletion on another device removes the row — a DELETE has no `new`', () => {
  const sale = heldSale();
  const store: Sale[] = [sale];

  // `raw` is undefined here: DELETE payloads carry only `old.id`.
  const changed = applyRealtimeRow(store, 'DELETE', sale.id, undefined, adoptSale);

  assert.equal(changed, true);
  assert.equal(store.length, 0);
  // A delete for a row this mirror never held has nothing to remove.
  assert.equal(applyRealtimeRow(store, 'DELETE', 'sale-none', undefined, adoptSale), false);
});

test('an unknown update is adopted; a payload without an id is ignored', () => {
  const store: Sale[] = [];

  assert.equal(applyRealtimeRow(store, 'UPDATE', null, serverSale, adoptSale), true);
  assert.equal(store.length, 1);
  assert.equal(applyRealtimeRow(store, 'UPDATE', 'sale-unknown', undefined, adoptSale), false);
  assert.equal(store.length, 1);
});
