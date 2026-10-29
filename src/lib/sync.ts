/**
 * Supabase sync layer for the local-first app.
 *
 * The app keeps all state in localStorage and is the source of truth. This
 * module mirrors selected rows to Supabase so data is not trapped in the
 * browser.
 *
 * ## Why a mapping layer exists at all
 *
 * The app mints its own string ids (`tenant-1761...`, `branch-main`,
 * `prod-123`) while the database declares every primary key as `UUID`. Sending
 * the app id straight through fails with `invalid input syntax for type uuid`,
 * which is why the mirror had never stored a single row.
 *
 * Rather than rewrite id generation across the app and its test suite, ids are
 * translated here, at the boundary:
 *
 *  - `toUuid()` is **deterministic** — the same app id always produces the same
 *    UUID — so re-syncing an edited row updates it instead of duplicating it.
 *  - Only columns that exist in the database are sent; app-only fields
 *    (`items`, `cashier_name`, `payment_details`, …) are carried by columns
 *    added in migration 20261024000002.
 *
 * Every call is best-effort: a failed sync must never break the sale, stock
 * adjustment or account creation the user actually asked for.
 */
import type {
  Branch,
  Customer,
  Expense,
  InventoryMovement,
  Product,
  ProductCategory,
  Sale,
  Tenant,
  UserAccount,
} from '../types';

/** Fixed namespace so the same app id maps to the same UUID on every device. */
const SYNC_NAMESPACE = '6f9619ff-8b86-d011-b42d-00c04fc964ff';

/** Well-formed UUID — the shape every id in the mirror already has. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

/**
 * Reverse index: UUID → app id, for every id this session has mapped.
 *
 * Realtime payloads arrive keyed by the database's UUID, which the app's own
 * entities never use. Without this, an echo of a row this tab just wrote would
 * look like an unknown record and be inserted a second time under a UUID.
 */
const appIdsByUuid = new Map<string, string>();

/** Resolve a database UUID back to the app id that produced it, if known. */
export function fromUuid(uuid: string | undefined | null): string | undefined {
  if (!uuid) return undefined;
  return appIdsByUuid.get(uuid);
}

/**
 * Bind a row this device read back from the mirror to this session.
 *
 * A second till fetching an account or a shop at sign-in receives ids it did
 * not mint. Recording `uuid → uuid` means a later re-sync of that row upserts
 * the row it came from instead of inserting a second copy under a freshly
 * hashed id, and that realtime events for it resolve to the local row, so
 * status changes and deletions made elsewhere still land here.
 *
 * Anything that is not already a UUID is left alone: it is an app id and
 * {@link toUuid} will derive one when it is actually written.
 */
export function bindMirrorId(id: string | undefined | null): string | undefined {
  if (!id || !isUuid(id)) return undefined;
  appIdsByUuid.set(id, id);
  return id;
}

/**
 * Deterministic UUID (v5 shape) derived from an app id.
 *
 * Uses FNV-1a over four byte ranges to fill 16 bytes, then stamps the RFC-4122
 * version (5) and variant (10xx) bits so the result is a well-formed UUID.
 * Deterministic — not cryptographic — which is exactly what upserts need.
 *
 * An id that is already a UUID is returned unchanged. Rows adopted from the
 * mirror carry the database's own keys, and re-hashing one would invent a
 * second identity for a row that exists — plus point every `tenant_id` written
 * from this device at a row nobody has.
 */
export function toUuid(appId: string): string {
  if (isUuid(appId)) {
    appIdsByUuid.set(appId, appId);
    return appId;
  }

  const key = `${SYNC_NAMESPACE}:${appId}`;
  const bytes = new Uint8Array(16);

  // Four independent FNV-1a passes, offset so each seeds differently.
  for (let pass = 0; pass < 4; pass += 1) {
    let hash = 0x811c9dc5 ^ (pass * 0x9e3779b9);
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const off = pass * 4;
    bytes[off] = (hash >>> 24) & 0xff;
    bytes[off + 1] = (hash >>> 16) & 0xff;
    bytes[off + 2] = (hash >>> 8) & 0xff;
    bytes[off + 3] = hash & 0xff;
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

  // Remember the reverse mapping so a realtime echo of this row can be
  // recognised as one we already hold instead of added again under a UUID.
  appIdsByUuid.set(uuid, appId);

  return uuid;
}

/** Safe nullable uuid — blank/undefined app ids become SQL NULL, never ''. */
const uuidOrNull = (id: string | undefined | null): string | null =>
  id && id.trim() ? toUuid(id) : null;

/**
 * A sync failure is worth seeing once, not on every keystroke.
 * The app must keep working whether or not Supabase is reachable.
 */
const warned = new Set<string>();
function noteFailure(table: string, message: string): void {
  const signature = `${table}:${message}`;
  if (warned.has(signature)) return;
  warned.add(signature);
  // eslint-disable-next-line no-console
  console.warn(`Supabase sync skipped (${table}):`, message);
}

type SyncResult = { error: { message: string } | null };

/**
 * Writes are serialised through a single FIFO queue.
 *
 * Why: `sales.tenant_id` and `products.tenant_id` are still foreign keys. If a
 * sale request outran its tenant's request the sale would be rejected on a
 * missing parent — the same silent-loss failure mode this module exists to
 * fix. A queue guarantees the parent insert is acknowledged first.
 *
 * Failures are caught inside the chain so one bad row can never wedge the
 * queue for everything behind it.
 */
let queue: Promise<void> = Promise.resolve();

function enqueue(table: string, send: () => PromiseLike<SyncResult>): void {
  queue = queue
    .then(() => Promise.resolve(send()))
    .then(({ error }) => {
      if (error) noteFailure(table, error.message);
    })
    .catch((err) => {
      noteFailure(table, err instanceof Error ? err.message : String(err));
    });
}

/** Fire a write, swallow and report failures. Never throws, never blocks. */
function push(table: string, promise: () => PromiseLike<SyncResult>): void {
  enqueue(table, promise);
}

/**
 * Write `parent` first, then `child`, as one ordered unit of work.
 * Used wherever a row references a tenant that may not have landed yet.
 */
function pushWithParent(
  c: SyncClient,
  table: string,
  parentTable: string,
  parentRow: Record<string, unknown>,
  child: () => PromiseLike<SyncResult>,
): void {
  queue = queue
    .then(async () => {
      // Best-effort: a failed parent is reported, then the child still runs so
      // the caller's intent is not silently dropped.
      try {
        const { error } = await Promise.resolve(
          c.from(parentTable).upsert([parentRow], { onConflict: 'id' }),
        );
        if (error) {
          noteFailure(parentTable, error.message);
        } else if (parentTable === 'tenants') {
          ensuredTenants.add(String(parentRow.id));
        }
      } catch (err) {
        noteFailure(parentTable, err instanceof Error ? err.message : String(err));
      }
    })
    .then(() => Promise.resolve(child()))
    .then(({ error }) => {
      if (error) noteFailure(table, error.message);
    })
    .catch((err) => {
      noteFailure(table, err instanceof Error ? err.message : String(err));
    });
}

/* -------------------------------------------------------------------------- */
/* Row mappers — one per table, sending only columns that exist.               */
/* -------------------------------------------------------------------------- */

export function tenantRow(t: Tenant): Record<string, unknown> {
  return {
    id: toUuid(t.id),
    name: t.name,
    slug: t.slug,
    logo_url: t.logo_url || null,
    phone: t.phone || null,
    email: t.email || null,
    address: t.address || null,
    tax_number: t.tax_number || null,
    currency: t.currency || 'GHS',
    is_active: t.is_active,
    // `cancelled` is valid in the schema but not in the app's union.
    subscription_status: t.subscription_status === 'suspended' ? 'suspended' : t.subscription_status,
    created_at: t.created_at,
  };
}

export function userRow(u: UserAccount): Record<string, unknown> {
  // Credentials are deliberately NOT mirrored. `password` and `pin` are the
  // account's secret; writing them to a row that any holder of the anon key
  // can read (pre-lockdown RLS) would expose every user's secret. Auth moves
  // to Supabase Auth, which stores its own server-side hash — the row carries
  // only non-secret profile fields. Omitting the keys leaves any legacy
  // plaintext columns untouched until the Stage B migration scrubs them.
  return {
    id: toUuid(u.id),
    tenant_id: uuidOrNull(u.tenant_id),
    shop_name: u.shop_name || null,
    full_name: u.full_name,
    email: u.email,
    phone: u.phone || null,
    role: u.role,
    is_active: u.is_active,
    created_at: u.created_at,
  };
}

export function productRow(p: Product): Record<string, unknown> {
  return {
    id: toUuid(p.id),
    tenant_id: uuidOrNull(p.tenant_id),
    category_id: uuidOrNull(p.category_id),
    category_name: p.category_name || null,
    name: p.name,
    sku: p.sku || null,
    barcode: p.barcode,
    cost_price: p.cost_price,
    avg_cost: p.avg_cost ?? null,
    selling_price: p.selling_price,
    stock_quantity: p.stock_quantity,
    min_stock_threshold: p.min_stock_threshold,
    image_url: p.image_url || null,
    unit: p.unit || null,
    is_active: p.is_active,
    created_at: p.created_at,
  };
}

export function customerRow(c: Customer): Record<string, unknown> {
  return {
    id: toUuid(c.id),
    tenant_id: uuidOrNull(c.tenant_id),
    name: c.name,
    phone: c.phone || null,
    email: c.email || null,
    loyalty_points: c.loyalty_points,
    total_spent: c.total_spent ?? 0,
    created_at: c.created_at,
  };
}

export function expenseRow(e: Expense): Record<string, unknown> {
  return {
    id: toUuid(e.id),
    tenant_id: uuidOrNull(e.tenant_id),
    branch_id: uuidOrNull(e.branch_id),
    category: e.category,
    amount: e.amount,
    description: e.description || null,
    // The app stores an ISO timestamp; the column is a DATE.
    expense_date: (e.expense_date || e.created_at || new Date().toISOString()).slice(0, 10),
    created_at: e.created_at,
  };
}

export function branchRow(b: Branch): Record<string, unknown> {
  return {
    id: toUuid(b.id),
    tenant_id: uuidOrNull(b.tenant_id),
    name: b.name,
    code: b.code,
    address: b.address || null,
    phone: b.phone || null,
    is_main: b.is_main,
    is_active: b.is_active,
  };
}

export function categoryRow(c: ProductCategory): Record<string, unknown> {
  return {
    id: toUuid(c.id),
    tenant_id: uuidOrNull(c.tenant_id),
    name: c.name,
    description: c.description || null,
    color: c.color || null,
    parent_id: uuidOrNull(c.parent_id ?? null),
    is_active: c.is_active,
    deactivated_at: c.deactivated_at || null,
    deactivated_by: uuidOrNull(c.deactivated_by),
    created_at: c.created_at,
  };
}

export function auditRow(a: {
  id: string;
  tenant_id?: string;
  user_id?: string;
  action: string;
  entity: string;
  entity_id?: string;
  details?: Record<string, unknown>;
  created_at: string;
}): Record<string, unknown> {
  return {
    id: toUuid(a.id),
    tenant_id: uuidOrNull(a.tenant_id),
    user_id: uuidOrNull(a.user_id),
    action: a.action,
    entity: a.entity,
    entity_id: a.entity_id || null,
    details: a.details ?? null,
    created_at: a.created_at,
  };
}

export function movementRow(m: InventoryMovement): Record<string, unknown> {
  return {
    id: toUuid(m.id),
    tenant_id: uuidOrNull(m.tenant_id),
    branch_id: uuidOrNull(m.branch_id),
    product_id: uuidOrNull(m.product_id),
    product_name: m.product_name || null,
    type: m.type,
    quantity: m.quantity,
    unit_cost: m.unit_cost ?? null,
    balance_after: m.balance_after ?? null,
    reference_type: m.reference_type || null,
    reference_id: m.reference_id || null,
    reason: m.reason || null,
    created_by: uuidOrNull(m.created_by),
    created_by_name: m.created_by_name || null,
    created_at: m.created_at,
  };
}

/**
 * A sale is one row in `sales` carrying a JSON snapshot of its lines.
 *
 * The structured `sale_items` table is intentionally not written here: it has
 * its own foreign keys and would fail independently, silently losing half the
 * receipt. The JSON snapshot keeps the receipt complete and re-printable.
 */
export function saleRow(s: Sale): Record<string, unknown> {
  return {
    id: toUuid(s.id),
    tenant_id: uuidOrNull(s.tenant_id),
    branch_id: uuidOrNull(s.branch_id),
    register_id: uuidOrNull(s.register_id),
    cashier_id: uuidOrNull(s.cashier_id),
    cashier_name: s.cashier_name || null,
    shop_name: s.shop_name || null,
    customer_name: s.customer_name || null,
    invoice_number: s.invoice_number,
    subtotal: s.subtotal,
    discount_amount: s.discount_amount,
    tax_amount: s.tax_amount,
    total_amount: s.total_amount,
    cost_amount: s.cost_amount,
    payment_method: s.payment_method,
    payment_details: s.payment_details ?? null,
    status: s.status,
    items: (s.items ?? []).map((item) => ({
      id: toUuid(item.id),
      product_id: uuidOrNull(item.product_id),
      product_name: item.product_name,
      barcode: item.barcode,
      unit_price: item.unit_price,
      cost_price: item.cost_price,
      quantity: item.quantity,
      discount_amount: item.discount_amount,
      tax_amount: item.tax_amount,
      total_amount: item.total_amount,
    })),
    created_at: s.created_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Public sync entry points                                                    */
/* -------------------------------------------------------------------------- */

/** Minimal slice of the Supabase client this layer needs. */
export interface SyncClient {
  from(table: string): {
    upsert(
      rows: Record<string, unknown>[],
      options?: { onConflict?: string },
    ): PromiseLike<SyncResult>;
    update(patch: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<SyncResult>;
    };
    delete(): { eq(column: string, value: string): PromiseLike<SyncResult> };
  };
}

/**
 * Parent tenant row, if the caller still has it.
 *
 * Child rows keep a `tenant_id` foreign key, so the tenant must exist in
 * Supabase before them. The app is free to sync a product minutes after the
 * browser was cleared, so this is looked up at call time rather than assumed.
 */
function parentTenantRow(
  tenantId: string | undefined | null,
  lookup: (id: string) => Tenant | undefined,
): Record<string, unknown> | null {
  if (!tenantId) return null;
  const tenant = lookup(tenantId);
  return tenant ? tenantRow(tenant) : null;
}

/**
 * Tenants whose insert has already succeeded this session.
 *
 * A child write re-ensures its parent so a freshly-created shop can receive
 * products immediately, but paying for that upsert on every single row would
 * double the request count for no benefit. Once a tenant's upsert has been
 * acknowledged it exists for the rest of the session, so it is skipped from
 * then on. A failed upsert is never recorded, so the next child retries it.
 */
const ensuredTenants = new Set<string>();

/** Queue a child write, ensuring its tenant lands first when it is known. */
function pushChild(
  c: SyncClient,
  table: string,
  tenantId: string | undefined | null,
  lookup: (id: string) => Tenant | undefined,
  row: Record<string, unknown>,
): void {
  const parent = parentTenantRow(tenantId, lookup);

  if (parent !== null && !ensuredTenants.has(String(parent.id))) {
    pushWithParent(c, table, 'tenants', parent, () =>
      c.from(table).upsert([row], { onConflict: 'id' }),
    );
    return;
  }

  push(table, () => c.from(table).upsert([row], { onConflict: 'id' }));
}

/**
 * Tenant lookup used by every child sync.
 *
 * Set once by DatabaseService (the only holder of `this.tenants`) so this
 * module stays free of a circular import back into the service.
 */
let tenantLookup: (id: string) => Tenant | undefined = () => undefined;

export function setTenantLookup(fn: (id: string) => Tenant | undefined): void {
  tenantLookup = fn;
}

export const syncTenant = (c: SyncClient, t: Tenant): void => {
  const uuid = toUuid(t.id);
  push('tenants', () =>
    c.from('tenants').upsert([tenantRow(t)], { onConflict: 'id' }).then((res) => {
      if (!res.error) ensuredTenants.add(uuid);
      return res;
    }),
  );
};

export const syncBranch = (c: SyncClient, b: Branch): void =>
  pushChild(c, 'branches', b.tenant_id, tenantLookup, branchRow(b));

export const syncUser = (c: SyncClient, u: UserAccount): void =>
  pushChild(c, 'users', u.tenant_id, tenantLookup, userRow(u));

export const syncProduct = (c: SyncClient, p: Product): void =>
  pushChild(c, 'products', p.tenant_id, tenantLookup, productRow(p));

export const syncCustomer = (c: SyncClient, cu: Customer): void =>
  pushChild(c, 'customers', cu.tenant_id, tenantLookup, customerRow(cu));

export const syncExpense = (c: SyncClient, e: Expense): void =>
  pushChild(c, 'expenses', e.tenant_id, tenantLookup, expenseRow(e));

export const syncSale = (c: SyncClient, s: Sale): void =>
  pushChild(c, 'sales', s.tenant_id, tenantLookup, saleRow(s));

export const syncCategory = (c: SyncClient, cat: ProductCategory): void =>
  pushChild(c, 'product_categories', cat.tenant_id, tenantLookup, categoryRow(cat));

export const syncMovement = (c: SyncClient, m: InventoryMovement): void =>
  pushChild(c, 'inventory_movements', m.tenant_id, tenantLookup, movementRow(m));

export function syncAudit(
  c: SyncClient,
  a: Parameters<typeof auditRow>[0],
): void {
  pushChild(c, 'audit_logs', a.tenant_id, tenantLookup, auditRow(a));
}

/** Remove a mirrored row. A no-op if it never landed. */
export function syncProductDelete(c: SyncClient, productId: string): void {
  push('products', () => c.from('products').delete().eq('id', toUuid(productId)));
}

/**
 * Remove a staff account.
 *
 * Deleting the row does not disturb history that merely *named* the person:
 * sales carry a denormalised `cashier_name` and movements a `created_by_name`,
 * so past receipts still show who rang them up after the login is gone.
 */
export function syncUserDelete(c: SyncClient, userId: string): void {
  push('users', () => c.from('users').delete().eq('id', toUuid(userId)));
}

export function syncTenantStatus(
  c: SyncClient,
  tenantId: string,
  patch: Record<string, unknown>,
): void {
  push('tenants', () => c.from('tenants').update(patch).eq('id', toUuid(tenantId)));
}

export function syncUserStatus(
  c: SyncClient,
  userId: string,
  patch: Record<string, unknown>,
): void {
  push('users', () => c.from('users').update(patch).eq('id', toUuid(userId)));
}

/**
 * Test seam: resolve once the queue has drained.
 *
 * The app never needs this — writes are fire-and-forget by design. The sync
 * test uses it to assert on the exact rows that were sent without polling.
 */
export function flushSync(): Promise<void> {
  return queue;
}
