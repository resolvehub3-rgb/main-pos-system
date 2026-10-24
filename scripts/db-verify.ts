/**
 * Verify the Supabase sync mirror end-to-end against the real database.
 *
 *   npx tsx scripts/db-verify.ts
 *
 * Imports the app's own mappers (src/lib/sync.ts) so this tests exactly what
 * the browser sends — not a hand-written copy that could drift. Pushes a full
 * scenario (tenant → owner → product → sale → movement → expense → customer)
 * and then reads each row back to confirm it landed.
 *
 * Requires migration 20261024000002_app_sync_compat.sql to be applied first.
 * Run with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in the environment.
 */
import { createClient } from '@supabase/supabase-js';
import type { Customer, Expense, InventoryMovement, Product, Sale, Tenant, UserAccount } from '../src/types/index';
import {
  flushSync,
  setTenantLookup,
  syncCategory,
  syncCustomer,
  syncExpense,
  syncMovement,
  syncProduct,
  syncSale,
  syncTenant,
  syncUser,
  toUuid,
} from '../src/lib/sync.ts';

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.VITE_SUPABASE_ANON_KEY!;
const db = createClient(url, key);

const stamp = Date.now();
const run = (label: string) => `${label}-${stamp}`;
const now = new Date().toISOString();

let checks = 0;
let passed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (ok) passed += 1;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/* -------------------------------------------------------------------------- */
/* Scenario — the shapes the real app produces (string ids, not UUIDs).        */
/* -------------------------------------------------------------------------- */

const tenant: Tenant = {
  id: run('tenant'),
  name: 'Verify Mart',
  slug: `verify-${stamp}`,
  phone: '0244000111',
  email: 'verify@example.com',
  address: 'Oxford Street, Accra',
  currency: 'GHS',
  is_active: true,
  subscription_status: 'active',
  created_at: now,
};

setTenantLookup((id) => (id === tenant.id ? tenant : undefined));

const owner: UserAccount = {
  id: run('user'),
  tenant_id: tenant.id,
  shop_name: tenant.name,
  full_name: 'Verify Owner',
  email: `verify-owner-${stamp}@example.com`,
  phone: '0244000112',
  role: 'shop_owner',
  is_active: true,
  created_at: now,
};

const product: Product = {
  id: run('prod'),
  tenant_id: tenant.id,
  name: 'Verify Rice 5kg',
  sku: `SKU-${stamp}`,
  barcode: `BC${stamp}`,
  cost_price: 40,
  avg_cost: 41,
  selling_price: 55,
  stock_quantity: 12,
  min_stock_threshold: 3,
  image_url: '',
  unit: 'bag',
  is_active: true,
  created_at: now,
};

const sale: Sale = {
  id: run('sale'),
  tenant_id: tenant.id,
  branch_id: 'branch-main',
  register_id: 'reg-01',
  cashier_id: owner.id,
  cashier_name: owner.full_name,
  shop_name: tenant.name,
  customer_name: 'Walk-in',
  invoice_number: `REC-${stamp.toString().slice(-6)}`,
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
      id: `${saleItemId()}`,
      sale_id: '', // filled by caller in the app; irrelevant to the mirror
      product_id: product.id,
      product_name: product.name,
      barcode: product.barcode,
      unit_price: 55,
      cost_price: 41,
      quantity: 2,
      discount_amount: 5,
      tax_amount: 0,
      total_amount: 105,
    },
  ],
};

function saleItemId(): string {
  return `item-${stamp}-0`;
}

const movement: InventoryMovement = {
  id: run('mov'),
  tenant_id: tenant.id,
  branch_id: 'branch-main',
  product_id: product.id,
  product_name: product.name,
  type: 'opening_stock',
  quantity: 12,
  unit_cost: 41,
  balance_after: 12,
  reference_type: 'manual',
  reason: 'Opening stock on product creation',
  created_by: owner.id,
  created_by_name: owner.full_name,
  created_at: now,
};

const expense: Expense = {
  id: run('exp'),
  tenant_id: tenant.id,
  branch_id: 'branch-main',
  category: 'Transport',
  amount: 25.5,
  description: 'Delivery run',
  expense_date: now.slice(0, 10),
  created_at: now,
};

const customer: Customer = {
  id: run('cust'),
  tenant_id: tenant.id,
  name: 'Ama Customer',
  phone: '0244000113',
  email: 'ama@example.com',
  loyalty_points: 40,
  total_spent: 250.75,
  created_at: now,
};

/* -------------------------------------------------------------------------- */
/* Push everything exactly as the app does: fire-and-forget through the queue. */
/* -------------------------------------------------------------------------- */

console.log('\nPushing scenario through src/lib/sync.ts ...\n');

syncTenant(db, tenant);
syncUser(db, owner);
syncProduct(db, product);
syncSale(db, sale);
syncMovement(db, movement);
syncExpense(db, expense);
syncCustomer(db, customer);
syncCategory(db, {
  id: run('cat'),
  tenant_id: tenant.id,
  name: 'Grains',
  color: '#F28C28',
  is_active: true,
  created_at: now,
});

// Wait for the FIFO queue to drain before reading anything back.
await flushSync();
// One extra tick in case the final promise resolved during our own await.
await new Promise((r) => setTimeout(r, 400));

/* -------------------------------------------------------------------------- */
/* Read back and assert                                                       */
/* -------------------------------------------------------------------------- */

console.log('Reading back ...\n');

const uuid = (id: string) => toUuid(id);

const tenantId = uuid(tenant.id);

const { data: tRow, error: tErr } = await db
  .from('tenants')
  .select('id, name, slug, currency, subscription_status')
  .eq('id', tenantId)
  .maybeSingle();
check('tenants row landed', !tErr && !!tRow, tErr?.message ?? JSON.stringify(tRow));

const { data: uRow, error: uErr } = await db
  .from('users')
  .select('id, email, role, full_name, tenant_id, is_active')
  .eq('id', uuid(owner.id))
  .maybeSingle();
check('users row landed (new table)', !uErr && !!uRow, uErr?.message ?? JSON.stringify(uRow));

const { data: pRow, error: pErr } = await db
  .from('products')
  .select('id, name, barcode, unit, category_name, avg_cost, stock_quantity')
  .eq('id', uuid(product.id))
  .maybeSingle();
check('products row landed', !pErr && !!pRow, pErr?.message ?? JSON.stringify(pRow));
check('products.unit preserved', pRow?.unit === 'bag', String(pRow?.unit));

const { data: sRow, error: sErr } = await db
  .from('sales')
  .select('id, cashier_name, shop_name, customer_name, payment_details, items, status, total_amount')
  .eq('id', uuid(sale.id))
  .maybeSingle();
check('sales row landed', !sErr && !!sRow, sErr?.message ?? JSON.stringify(sRow));
check('sales.cashier_name mapped', sRow?.cashier_name === owner.full_name, String(sRow?.cashier_name));
check('sales.shop_name mapped', sRow?.shop_name === tenant.name, String(sRow?.shop_name));
check(
  'sales.items snapshot has 1 line',
  Array.isArray(sRow?.items) && sRow.items.length === 1,
  JSON.stringify(sRow?.items)?.slice(0, 80),
);
check(
  'sales.payment_details preserved tender detail',
  (sRow?.payment_details as { cash_tendered?: number } | null)?.cash_tendered === 120,
  JSON.stringify(sRow?.payment_details),
);
check('sales status = completed', sRow?.status === 'completed', String(sRow?.status));

const { data: mRow, error: mErr } = await db
  .from('inventory_movements')
  .select('id, type, quantity, product_name, created_by_name, balance_after, unit_cost')
  .eq('id', uuid(movement.id))
  .maybeSingle();
check('inventory_movements row landed', !mErr && !!mRow, mErr?.message ?? JSON.stringify(mRow));
check('movement.product_name preserved', mRow?.product_name === product.name, String(mRow?.product_name));

const { data: eRow, error: eErr } = await db
  .from('expenses')
  .select('id, category, amount, expense_date, branch_id')
  .eq('id', uuid(expense.id))
  .maybeSingle();
check('expenses row landed', !eErr && !!eRow, eErr?.message ?? JSON.stringify(eRow));

const { data: cRow, error: cErr } = await db
  .from('customers')
  .select('id, name, loyalty_points, total_spent')
  .eq('id', uuid(customer.id))
  .maybeSingle();
check('customers row landed', !cErr && !!cRow, cErr?.message ?? JSON.stringify(cRow));
check('customers.total_spent preserved', Number(cRow?.total_spent) === 250.75, String(cRow?.total_spent));

const { data: catRow, error: catErr } = await db
  .from('product_categories')
  .select('id, name, color, is_active')
  .eq('id', uuid(`cat-${stamp}`))
  .maybeSingle();
check('product_categories row landed', !catErr && !!catRow, catErr?.message ?? JSON.stringify(catRow));

// audit_logs.user_id referenced `profiles` (always empty) until the compat
// migration dropped it — every entry was rejected before that.
const auditId = run('audit');
const { error: auditErr } = await db.from('audit_logs').insert([
  {
    id: uuid(auditId),
    tenant_id: tenantId,
    user_id: uuid(owner.id),
    action: 'product.create',
    entity: 'products',
    entity_id: uuid(product.id),
    details: { name: product.name },
    created_at: now,
  },
]);
check('audit_logs row landed', !auditErr, auditErr?.message ?? 'inserted');

// product_categories.deactivated_by referenced `profiles`, which never has
// rows — deactivating a category silently failed to mirror.
const { error: deactErr } = await db
  .from('product_categories')
  .update({ is_active: false, deactivated_at: now, deactivated_by: uuid(owner.id) })
  .eq('id', uuid(`cat-${stamp}`));
check('category deactivation mirrors (deactivated_by FK)', !deactErr, deactErr?.message ?? 'updated');

/* -------------------------------------------------------------------------- */
/* Idempotency: re-sync must update, not duplicate.                            */
/* -------------------------------------------------------------------------- */

console.log('');
const beforeCount = await countSales(tenantId);
sale.total_amount = 99;
syncSale(db, sale);
await flushSync();
await new Promise((r) => setTimeout(r, 400));
const afterCount = await countSales(tenantId);

const { data: reRow } = await db
  .from('sales')
  .select('total_amount')
  .eq('id', uuid(sale.id))
  .maybeSingle();

check(
  're-sync updates instead of duplicating',
  afterCount === beforeCount && Number(reRow?.total_amount) === 99,
  `count ${beforeCount} → ${afterCount}, total ${reRow?.total_amount}`,
);

// sales UNIQUE (tenant_id, invoice_number) used to reject a second sale whose
// invoice number repeated — `REC-` + last 6 digits of Date.now() cycles about
// every 16.7 minutes, so this happened in ordinary use.
const clashSale: Sale = {
  ...sale,
  id: run('sale-clash'),
  invoice_number: sale.invoice_number, // deliberately identical
  total_amount: 10,
};
syncSale(db, clashSale);
await flushSync();
await new Promise((r) => setTimeout(r, 400));

const { data: clashRow, error: clashErr } = await db
  .from('sales')
  .select('id, invoice_number')
  .eq('id', uuid(clashSale.id))
  .maybeSingle();
check(
  'duplicate invoice number does not discard the sale',
  !clashErr && !!clashRow,
  clashErr?.message ?? JSON.stringify(clashRow),
);

async function countSales(tid: string): Promise<number> {
  const { count } = await db
    .from('sales')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tid);
  return count ?? -1;
}

/* -------------------------------------------------------------------------- */
/* Cleanup                                                                     */
/* -------------------------------------------------------------------------- */

console.log('\nCleaning up test rows ...');
for (const [table, id] of [
  ['sales', uuid(sale.id)],
  ['sales', uuid(clashSale.id)],
  ['audit_logs', uuid(auditId)],
  ['inventory_movements', uuid(movement.id)],
  ['expenses', uuid(expense.id)],
  ['customers', uuid(customer.id)],
  ['product_categories', uuid(`cat-${stamp}`)],
  ['products', uuid(product.id)],
  ['users', uuid(owner.id)],
  ['tenants', uuid(tenant.id)],
] as Array<[string, string]>) {
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) console.log(`  (could not delete ${table}: ${error.message})`);
}

console.log(`\n${passed}/${checks} checks passed\n`);
process.exit(passed === checks ? 0 : 1);
