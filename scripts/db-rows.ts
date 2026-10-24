/**
 * Inspect the mirrored rows for a tenant: does the account/supermarket created
 * through the UI actually exist in Supabase?
 *
 *   npx tsx scripts/db-rows.ts            # everything
 *   npx tsx scripts/db-rows.ts sync-test  # filter by name/email substring
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);
const filter = (process.argv[2] || '').toLowerCase();

const hit = (s: string | null | undefined) =>
  !filter || (s ?? '').toLowerCase().includes(filter);

async function show(
  table: string,
  columns: string,
  pick: (row: Record<string, unknown>) => string,
): Promise<void> {
  const { data, error } = await db.from(table).select(columns);
  if (error) {
    console.log(`${table}: ERROR ${error.code}: ${error.message}`);
    return;
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const shown = rows.filter((r) => pick(r).toLowerCase().includes(filter) || !filter);
  console.log(`\n${table}  (${rows.length} total${shown.length !== rows.length ? `, ${shown.length} matching` : ''})`);
  for (const r of shown) console.log(`  ${pick(r)}`);
}

await show('tenants', 'id, name, slug, is_active, subscription_status, created_at',
  (r) => `${r.name}  slug=${r.slug}  active=${r.is_active}  ${r.created_at}`);
await show('branches', 'id, name, code, tenant_id, is_main, is_active',
  (r) => `${r.name}  code=${r.code}  main=${r.is_main}  active=${r.is_active}  tenant=${String(r.tenant_id).slice(0, 8)}…`);
await show('users', 'id, email, full_name, role, tenant_id, is_active, shop_name',
  (r) => `${r.email}  ${r.role}  active=${r.is_active}  shop=${r.shop_name ?? '—'}  id=${String(r.id).slice(0, 8)}…`);
await show('products', 'id, name, barcode, unit, stock_quantity, tenant_id',
  (r) => `${r.name}  bc=${r.barcode}  unit=${r.unit ?? '—'}  qty=${r.stock_quantity}`);
await show('product_categories', 'id, name, is_active, tenant_id',
  (r) => `${r.name}  active=${r.is_active}`);
await show('sales', 'id, invoice_number, total_amount, status, cashier_name, shop_name, created_at',
  (r) => `${r.invoice_number}  GHS ${r.total_amount}  ${r.status}  by=${r.cashier_name ?? '—'}  ${r.shop_name ?? ''}  ${String(r.created_at).slice(0, 19)}`);
await show('inventory_movements', 'id, type, quantity, product_name, created_at',
  (r) => `${r.type}  qty=${r.quantity}  ${r.product_name ?? '—'}  ${String(r.created_at).slice(0, 19)}`);

// Duplicate detection — the thing that would indicate a broken mirror.
console.log('\n--- integrity ---');
const emails = new Map<string, number>();
const { data: users } = await db.from('users').select('email');
for (const u of (users ?? []) as Array<{ email: string }>) {
  const k = (u.email ?? '').toLowerCase();
  emails.set(k, (emails.get(k) ?? 0) + 1);
}
const dupEmails = [...emails].filter(([, n]) => n > 1);
console.log(dupEmails.length
  ? `  DUPLICATE emails: ${dupEmails.map(([e, n]) => `${e}×${n}`).join(', ')}`
  : '  no duplicate emails');

const slugs = new Map<string, number>();
const { data: tenants } = await db.from('tenants').select('slug');
for (const t of (tenants ?? []) as Array<{ slug: string }>) {
  slugs.set(t.slug, (slugs.get(t.slug) ?? 0) + 1);
}
const dupSlugs = [...slugs].filter(([, n]) => n > 1);
console.log(dupSlugs.length
  ? `  DUPLICATE slugs: ${dupSlugs.map(([s, n]) => `${s}×${n}`).join(', ')}`
  : '  no duplicate slugs');

const invoices = new Map<string, number>();
const { data: sales } = await db.from('sales').select('invoice_number, tenant_id');
for (const s of (sales ?? []) as Array<{ invoice_number: string; tenant_id: string }>) {
  const k = `${s.tenant_id}:${s.invoice_number}`;
  invoices.set(k, (invoices.get(k) ?? 0) + 1);
}
const dupInv = [...invoices].filter(([, n]) => n > 1);
console.log(dupInv.length
  ? `  DUPLICATE invoice numbers (same tenant): ${dupInv.length}`
  : '  no duplicate invoice numbers');

console.log('');
