/**
 * Report the live sync state: is the compat migration in place, and how many
 * rows has the mirror actually stored?
 *
 *   npx tsx scripts/db-status.ts
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

const tables = [
  'tenants',
  'users',
  'profiles',
  'products',
  'product_categories',
  'customers',
  'sales',
  'expenses',
  'inventory_movements',
  'audit_logs',
];

console.log('\nRow counts visible to the anon key:\n');
for (const t of tables) {
  const { count, error } = await db
    .from(t)
    .select('id', { count: 'exact', head: true });
  console.log(
    `  ${error ? '?' : ' '} ${t.padEnd(22)} ${error ? `ERROR ${error.code}: ${error.message}` : String(count ?? 0)}`,
  );
}

// Migration markers: columns added only by 20261024000002_app_sync_compat.sql.
console.log('\nMigration markers (columns that only exist after the compat migration):\n');
const markers: Array<[string, string, string]> = [
  ['sales', 'cashier_name', ''],
  ['sales', 'items', ''],
  ['customers', 'total_spent', ''],
  ['products', 'unit', ''],
  ['inventory_movements', 'product_name', ''],
];

for (const [table, column] of markers) {
  const { data, error } = await db.from(table).select(column).limit(1);
  console.log(`  ${error ? 'MISSING' : 'ok    '} ${table}.${column}${error ? ` — ${error.message}` : ''}`);
  void data;
}

// The `users` table only exists if the compat migration ran.
const { error: usersErr } = await db.from('users').select('id').limit(1);
console.log(`  ${usersErr ? 'MISSING' : 'ok    '} public.users (new table)${usersErr ? ` — ${usersErr.message}` : ''}`);

// Does anon have a permissive policy, or is RLS still gating writes?
console.log('\nWrite probe (inserts then deletes one scratch tenant):\n');
const scratchId = `ffffffff-ffff-4fff-8fff-${Date.now().toString(16).padStart(12, '0')}`;
const { error: insErr } = await db.from('tenants').insert([
  {
    id: scratchId,
    name: 'Sync Status Scratch',
    slug: `scratch-${Date.now()}`,
    currency: 'GHS',
    is_active: false,
    subscription_status: 'trial',
    created_at: new Date().toISOString(),
  },
]);
if (insErr) {
  console.log(`  FAIL anon INSERT blocked — ${insErr.code}: ${insErr.message}`);
} else {
  console.log('  ok   anon INSERT allowed (RLS relaxed for local-first sync)');
  const { error: delErr } = await db.from('tenants').delete().eq('id', scratchId);
  console.log(`  ${delErr ? 'FAIL' : 'ok  '} anon DELETE ${delErr ? `blocked — ${delErr.message}` : 'allowed (scratch row removed)'}`);
}
console.log('');
