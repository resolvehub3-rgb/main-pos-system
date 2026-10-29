import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  categoryRow,
  customerRow,
  expenseRow,
  flushSync,
  fromUuid,
  productRow,
  saleRow,
  setTenantLookup,
  syncSale,
  syncTenant,
  tenantRow,
  toUuid,
  bindMirrorId,
  userRow,
  type SyncClient,
} from './sync.ts';
import type { Sale, Tenant, UserAccount } from '../types/index';

const now = '2026-10-24T10:00:00.000Z';

const tenant: Tenant = {
  id: 'tenant-1761000000000-abc',
  name: 'Accra Fresh Mart',
  slug: 'accra-fresh-mart',
  phone: '0244000001',
  email: 'shop@example.com',
  address: 'Oxford St',
  currency: 'GHS',
  is_active: true,
  subscription_status: 'active',
  created_at: now,
};

test('toUuid is deterministic so re-syncs upsert instead of duplicating', () => {
  assert.equal(toUuid('tenant-1'), toUuid('tenant-1'));
  assert.notEqual(toUuid('tenant-1'), toUuid('tenant-2'));
});

test('toUuid emits a well-formed RFC-4122 UUID', () => {
  const uuid = toUuid('prod-123');
  assert.match(
    uuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'must be version 5 with the 10xx variant bits',
  );
});

test('toUuid maps distinct app ids to distinct UUIDs across a realistic batch', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i += 1) seen.add(toUuid(`tenant-${i}`));
  assert.equal(seen.size, 5000, 'collision in 5000 ids');
});

test('fromUuid resolves a UUID back to the app id that produced it', () => {
  const uuid = toUuid('branch-main');
  assert.equal(fromUuid(uuid), 'branch-main');
  assert.equal(fromUuid('00000000-0000-0000-0000-000000000000'), undefined);
  assert.equal(fromUuid(undefined), undefined);
  assert.equal(fromUuid(null), undefined);
});

test('an id already in mirror form is the row identity, not input to be hashed', () => {
  const mirrorId = '1f50ae65-340b-5f00-aa20-d15f51b19202';

  assert.equal(toUuid(mirrorId), mirrorId, 're-hashing would invent a second row');
  assert.equal(fromUuid(mirrorId), mirrorId, 'and this session must still recognise it');

  // The failure this prevents: a till that adopted a shop writes products and
  // sales under that tenant id. Hashed again, every one of those foreign keys
  // would point at a tenant nobody has.
  assert.equal(tenantRow({ ...tenant, id: mirrorId }).id, mirrorId);
  assert.equal(
    userRow({
      id: '9ad23b0e-1e2c-5f4a-8e1f-0b5f0f9c1d77',
      tenant_id: mirrorId,
      full_name: 'Adopted Cashier',
      email: 'cashier@example.com',
      phone: '+233 24 000 0000',
      role: 'cashier',
      is_active: true,
      created_at: now,
    }).tenant_id,
    mirrorId,
  );
});

test('bindMirrorId claims an adopted row without inventing an identity for it', () => {
  const mirrorId = 'd4946dc8-1302-557d-98b5-1b1ed8ac0cb3';

  assert.equal(bindMirrorId(mirrorId), mirrorId);
  assert.equal(fromUuid(mirrorId), mirrorId, 'a DELETE from another till resolves here');

  assert.equal(bindMirrorId('tenant-local-1'), undefined, 'an app id has no mirror identity yet');
  assert.equal(bindMirrorId(undefined), undefined);
  assert.equal(bindMirrorId(null), undefined);
});

test('tenantRow sends only columns the tenants table has', () => {
  const row = tenantRow(tenant);
  assert.equal(row.id, toUuid(tenant.id));
  assert.equal(row.name, 'Accra Fresh Mart');
  assert.equal(row.subscription_status, 'active');
  assert.equal(row.currency, 'GHS');
  assert.equal(row.is_active, true);
  // No undefined anywhere: PostgREST rejects it as invalid JSON.
  for (const [k, v] of Object.entries(row)) {
    assert.notEqual(v, undefined, `${k} is undefined`);
  }
});

test('userRow maps to the new users table and keeps the role the CHECK allows', () => {
  const user: UserAccount = {
    id: 'user-1000-xyz',
    tenant_id: tenant.id,
    shop_name: 'Accra Fresh Mart',
    full_name: 'Kwame Owner',
    email: 'kwame@example.com',
    phone: '0244000002',
    role: 'shop_owner',
    is_active: true,
    created_at: now,
  };
  const row = userRow(user);
  assert.equal(row.id, toUuid(user.id));
  assert.equal(row.tenant_id, toUuid(tenant.id));
  assert.equal(row.role, 'shop_owner');
  assert.equal(row.shop_name, 'Accra Fresh Mart');
});

test('userRow never mirrors account credentials to the remote database', () => {
  // Regression guard: passwords and PINs must never leave the device. They
  // used to be written to a row any holder of the anon key could read. Auth
  // moves to Supabase Auth, which keeps its own server-side hash.
  const row = userRow({
    id: 'user-cred',
    full_name: 'Kwame Owner',
    email: 'kwame@example.com',
    phone: '0244000002',
    role: 'shop_owner',
    password: 'super-secret-password',
    pin: '9876',
    is_active: true,
    created_at: now,
  });
  assert.ok(!('password' in row), 'password must not be present in the mirrored row');
  assert.ok(!('pin' in row), 'pin must not be present in the mirrored row');
});

test('blank ids become SQL NULL rather than an empty string', () => {
  const row = userRow({
    id: 'user-super',
    full_name: 'Super Administrator',
    email: 'admin@example.com',
    phone: '',
    role: 'super_admin',
    is_active: true,
    created_at: now,
    // tenant_id intentionally omitted: a super admin belongs to no shop
  });
  assert.equal(row.tenant_id, null);
});

test('productRow carries the free-text unit the app stores', () => {
  const row = productRow({
    id: 'prod-1',
    tenant_id: tenant.id,
    category_id: 'cat-9',
    category_name: 'Grains',
    name: 'Rice 5kg',
    sku: 'SKU-1',
    barcode: 'BC1',
    cost_price: 40,
    avg_cost: 41,
    selling_price: 55,
    stock_quantity: 12,
    min_stock_threshold: 3,
    image_url: '',
    unit: 'bag',
    is_active: true,
    created_at: now,
  });
  assert.equal(row.unit, 'bag');
  assert.equal(row.category_name, 'Grains');
  assert.equal(row.category_id, toUuid('cat-9'));
  assert.equal(row.barcode, 'BC1');
});

test('expenseRow truncates the ISO timestamp to the DATE column', () => {
  const row = expenseRow({
    id: 'exp-1',
    tenant_id: tenant.id,
    branch_id: 'branch-main',
    category: 'Transport',
    amount: 25.5,
    description: 'Delivery',
    expense_date: now,
    created_at: now,
  });
  assert.equal(row.expense_date, '2026-10-24');
  assert.equal(row.branch_id, toUuid('branch-main'));
});

test('customerRow preserves lifetime spend', () => {
  const row = customerRow({
    id: 'cust-1',
    tenant_id: tenant.id,
    name: 'Ama',
    phone: '0244',
    loyalty_points: 40,
    total_spent: 250.75,
    created_at: now,
  });
  assert.equal(row.total_spent, 250.75);
  assert.equal(row.email, null);
});

test('categoryRow maps the parent id to a UUID and keeps activation state', () => {
  const row = categoryRow({
    id: 'cat-1',
    tenant_id: tenant.id,
    name: 'Grains',
    parent_id: 'cat-parent',
    is_active: true,
    created_at: now,
  });
  assert.equal(row.parent_id, toUuid('cat-parent'));
  assert.equal(row.is_active, true);
});

test('saleRow keeps tender detail and the receipt line snapshot', () => {
  const sale: Sale = {
    id: 'sale-1',
    tenant_id: tenant.id,
    branch_id: 'branch-main',
    register_id: 'reg-01',
    cashier_id: 'user-1000-xyz',
    cashier_name: 'Kwame Owner',
    shop_name: 'Accra Fresh Mart',
    customer_name: 'Walk-in',
    invoice_number: 'REC-123456',
    subtotal: 110,
    discount_amount: 5,
    tax_amount: 0,
    total_amount: 105,
    cost_amount: 82,
    payment_method: 'cash',
    payment_details: { cash_tendered: 120, change_due: 15 },
    status: 'completed',
    created_at: now,
    items: [
      {
        id: 'item-1',
        sale_id: 'sale-1',
        product_id: 'prod-1',
        product_name: 'Rice 5kg',
        barcode: 'BC1',
        unit_price: 55,
        cost_price: 41,
        quantity: 2,
        discount_amount: 5,
        tax_amount: 0,
        total_amount: 105,
      },
    ],
  };

  const row = saleRow(sale);
  assert.equal(row.cashier_name, 'Kwame Owner');
  assert.equal(row.shop_name, 'Accra Fresh Mart');
  assert.deepEqual(row.payment_details, { cash_tendered: 120, change_due: 15 });

  const items = row.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 1);
  assert.equal(items[0].product_name, 'Rice 5kg');
  assert.equal(items[0].product_id, toUuid('prod-1'));
  assert.equal(items[0].quantity, 2);

  // Values that must be non-null for the JSONB snapshot to be well-formed.
  assert.equal(row.status, 'completed');
  assert.equal(row.invoice_number, 'REC-123456');
});

/* -------------------------------------------------------------------------- */
/* Ordering: a child must never outrun the tenant it references.               */
/* -------------------------------------------------------------------------- */

/** Captures calls in order so the test can assert on sequencing. */
function recordingClient(existingTenants: string[] = []): {
  client: SyncClient;
  calls: string[];
} {
  const calls: string[] = [];
  const tenantIds = new Set(existingTenants);

  const client: SyncClient = {
    from(table: string) {
      return {
        upsert(rows: Array<Record<string, unknown>>) {
          const id = String(rows[0]?.id ?? '');
          if (table === 'tenants') tenantIds.add(id);
          calls.push(`upsert ${table}`);
          // A sale whose tenant is absent must be rejected, as Postgres does.
          if (
            table === 'sales' &&
            rows[0]?.tenant_id &&
            !tenantIds.has(String(rows[0].tenant_id))
          ) {
            return Promise.resolve({
              error: { message: 'insert or update on table "sales" violates foreign key' },
            });
          }
          return Promise.resolve({ error: null });
        },
        update() {
          return { eq: () => Promise.resolve({ error: null }) };
        },
        delete() {
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };

  return { client, calls };
}

test('a sale never outruns the tenant it references', async () => {
  setTenantLookup((id) => (id === tenant.id ? tenant : undefined));
  const { client, calls } = recordingClient();

  syncTenant(client, tenant);
  syncSale(client, {
    id: 'sale-ordering',
    tenant_id: tenant.id,
    branch_id: 'branch-main',
    cashier_id: 'user-1',
    cashier_name: 'Kwame Owner',
    shop_name: 'Accra Fresh Mart',
    invoice_number: 'REC-1',
    subtotal: 10,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 10,
    cost_amount: 6,
    payment_method: 'cash',
    status: 'completed',
    created_at: now,
    items: [],
  } as Sale);

  await flushSync();
  await new Promise((r) => setTimeout(r, 50));

  // The tenant must be written before the sale — the sale's foreign key
  // depends on it. Both requests are enqueued in the same tick, before either
  // resolves, so the tenant may be upserted twice; that is idempotent and
  // still strictly ordered ahead of the sale.
  assert.equal(calls[calls.length - 1], 'upsert sales', 'sale must be last');
  assert.equal(calls[0], 'upsert tenants', 'tenant must be first');
  assert.ok(
    calls.indexOf('upsert sales') > calls.lastIndexOf('upsert tenants'),
    `tenant must be acknowledged before the sale: ${calls.join(' -> ')}`,
  );
  assert.ok(!calls.some((c) => c.includes('sales') && calls.indexOf(c) === 0));
});

test('an already-acknowledged tenant is not re-upserted for later children', async () => {
  setTenantLookup((id) => (id === tenant.id ? tenant : undefined));
  const { client, calls } = recordingClient();

  syncTenant(client, tenant);
  await flushSync();
  await new Promise((r) => setTimeout(r, 50));

  calls.length = 0;

  // First child still pays for the parent-ensure it cannot know is done...
  const first: Sale = {
    id: 'sale-later-1',
    tenant_id: tenant.id,
    branch_id: 'branch-main',
    cashier_id: 'user-1',
    cashier_name: 'Kwame Owner',
    shop_name: 'Accra Fresh Mart',
    invoice_number: 'REC-3',
    subtotal: 10,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 10,
    cost_amount: 6,
    payment_method: 'cash',
    status: 'completed',
    created_at: now,
    items: [],
  };
  syncSale(client, first);
  await flushSync();
  await new Promise((r) => setTimeout(r, 50));
  calls.length = 0;

  // ...but once acknowledged, subsequent rows skip the redundant parent write.
  syncSale(client, { ...first, id: 'sale-later-2', invoice_number: 'REC-4' });
  await flushSync();
  await new Promise((r) => setTimeout(r, 50));

  assert.deepEqual(calls, ['upsert sales']);
});

test('a child still syncs when its tenant is unknown', async () => {
  setTenantLookup(() => undefined);
  const { client, calls } = recordingClient();

  syncSale(client, {
    id: 'sale-orphan',
    tenant_id: 'tenant-missing',
    branch_id: 'branch-main',
    cashier_id: 'user-1',
    cashier_name: 'Kwame Owner',
    shop_name: 'Shop',
    invoice_number: 'REC-2',
    subtotal: 10,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 10,
    cost_amount: 6,
    payment_method: 'cash',
    status: 'completed',
    created_at: now,
    items: [],
  } as Sale);

  await flushSync();
  await new Promise((r) => setTimeout(r, 50));

  assert.deepEqual(calls, ['upsert sales'], 'no parent to queue');
});
