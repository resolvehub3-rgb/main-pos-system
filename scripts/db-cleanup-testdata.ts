/**
 * Remove a throwaway supermarket created during verification, from both
 * Supabase and this browser's localStorage (leaving either behind would let the
 * next backfill re-create it).
 *
 *   npx tsx scripts/db-cleanup-testdata.ts "Filter Test Mart"
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);
const TENANT_NAME = process.argv[2];

if (!TENANT_NAME) {
  console.log('usage: npx tsx scripts/db-cleanup-testdata.ts "<tenant name>"');
  process.exit(1);
}

const { data: tenant, error: tErr } = await db
  .from('tenants')
  .select('id, name, slug')
  .eq('name', TENANT_NAME)
  .maybeSingle();

if (tErr) {
  console.log(`lookup failed: ${tErr.code}: ${tErr.message}`);
  process.exit(1);
}
if (!tenant) {
  console.log(`no row named "${TENANT_NAME}" — nothing to clean up.`);
  process.exit(0);
}

console.log(`Removing ${TENANT_NAME} (${tenant.id}) and everything under it…`);

// Children first: branches/users still carry a tenant_id foreign key.
const { data: branches } = await db.from('branches').select('id').eq('tenant_id', tenant.id);
const { data: users } = await db.from('users').select('id, email').eq('tenant_id', tenant.id);
const { data: products } = await db.from('products').select('id').eq('tenant_id', tenant.id);
const { data: categories } = await db.from('product_categories').select('id').eq('tenant_id', tenant.id);
const { data: sales } = await db.from('sales').select('id').eq('tenant_id', tenant.id);
const { data: movements } = await db.from('inventory_movements').select('id').eq('tenant_id', tenant.id);

for (const [table, rows] of [
  ['inventory_movements', movements],
  ['sales', sales],
  ['product_categories', categories],
  ['products', products],
  ['users', users],
  ['branches', branches],
] as Array<[string, { id: string }[] | null]>) {
  if (!rows?.length) continue;
  const { error } = await db.from(table).delete().in('id', rows.map((r) => r.id));
  console.log(`  ${error ? 'FAIL' : 'ok  '} ${table}: ${rows.length} row(s)${error ? ` — ${error.message}` : ''}`);
}

const { error: delErr } = await db.from('tenants').delete().eq('id', tenant.id);
console.log(`  ${delErr ? 'FAIL' : 'ok  '} tenants: 1 row${delErr ? ` — ${delErr.message}` : ''}`);

const { data: left } = await db.from('tenants').select('name');
console.log(`\nTenants remaining: ${(left ?? []).map((t) => t.name).join(', ') || '(none)'}`);
console.log(`\nNow clear the same shop from localStorage (the browser still holds it).`);
