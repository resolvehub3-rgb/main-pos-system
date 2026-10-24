import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  Product,
  Sale,
  SaleItem,
  Tenant,
  Branch,
  CashRegisterShift,
  InventoryMovement,
  InventoryMovementType,
  MovementReferenceType,
  ProductCategory,
  Customer,
  Expense,
  SubscriptionPlan,
  ParkedCart,
  CashMovement,
  CartItem,
  UserRole,
  UserAccount,
  PaymentMethod,
} from '../types/index.ts';
import { canManageCategories, canViewStockBook, canAdjustStock } from './permissions.ts';
import {
  weightedAverageOnReceipt,
  effectiveUnitCost,
  buildStockBook,
  type StockBookData,
} from './stockBook.ts';
import {
  syncTenant,
  syncTenantStatus,
  syncBranch,
  syncUser,
  syncUserStatus,
  syncProduct,
  syncProductDelete,
  syncCustomer,
  syncExpense,
  syncSale,
  syncCategory,
  syncMovement,
  syncAudit,
  setTenantLookup,
  fromUuid,
} from './sync.ts';

// Environment variables for real Supabase deployment
const getEnvVar = (key: string): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  return '';
};

const ENV_SUPABASE_URL = getEnvVar('VITE_SUPABASE_URL');
const ENV_SUPABASE_ANON_KEY = getEnvVar('VITE_SUPABASE_ANON_KEY');

// First super-admin bootstrap credentials (see docs/DEPLOYMENT.md)
const ENV_SUPER_ADMIN_EMAIL = getEnvVar('VITE_SUPER_ADMIN_EMAIL');
const ENV_SUPER_ADMIN_PASSWORD = getEnvVar('VITE_SUPER_ADMIN_PASSWORD');

// Storage keys for real persistent data and user auth session
const STORAGE_KEY_CONFIG = 'samtech_supabase_config';
const STORAGE_KEY_DATA = 'samtech_pos_database_realtime_v1';
const STORAGE_KEY_SESSION = 'samtech_auth_session';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isConnected: boolean;
  statusMessage: string;
}

// Persistent Realtime Database Layer with Direct Supabase Mirroring
// NO MOCK DATA - Starts completely clean and empty as requested
class DatabaseService {
  private products: Product[] = [];
  private sales: Sale[] = [];
  private tenants: Tenant[] = [];
  private branches: Branch[] = [];
  private shifts: CashRegisterShift[] = [];
  private movements: InventoryMovement[] = [];
  private categories: ProductCategory[] = [];
  private users: UserAccount[] = [];
  private customers: Customer[] = [];
  private expenses: Expense[] = [];
  private plans: SubscriptionPlan[] = [];
  private parkedCarts: ParkedCart[] = [];
  private cashMovements: CashMovement[] = [];
  private currentUser: UserAccount | null = null;
  private listeners: Array<() => void> = [];
  private supabaseClient: SupabaseClient | null = null;
  private realtimeChannel: any = null;
  private config: SupabaseConfig = {
    url: ENV_SUPABASE_URL,
    anonKey: ENV_SUPABASE_ANON_KEY,
    isConnected: false,
    statusMessage: 'Realtime Database Ready (Connect your Supabase project in the header)',
  };

  constructor() {
    this.loadState();
    this.initSupabaseClient();
    // Let the sync layer resolve a row's tenant when it queues a child write,
    // so the tenant is always acknowledged before the row that references it.
    setTenantLookup((id) => this.tenants.find((t) => t.id === id));
    this.bootstrapSuperAdmin();
  }

  /**
   * First super-admin bootstrap.
   *
   * When VITE_SUPER_ADMIN_EMAIL and VITE_SUPER_ADMIN_PASSWORD are configured,
   * the account is guaranteed to exist as role 'super_admin' on every start:
   * it is created if missing, otherwise promoted and its password synced so the
   * documented credentials always work. Never throws — the app must always start.
   */
  private bootstrapSuperAdmin(): void {
    try {
      const email = ENV_SUPER_ADMIN_EMAIL.trim().toLowerCase();
      const password = ENV_SUPER_ADMIN_PASSWORD;
      if (!email || !password) return;

      const existing = this.users.find((u) => u.email.trim().toLowerCase() === email);

      if (!existing) {
        this.addUser({
          email,
          password,
          full_name: 'Super Administrator',
          phone: '',
          role: 'super_admin',
          is_active: true,
        });
        return;
      }

      const needsPromotion = existing.role !== 'super_admin';
      const needsPassword = existing.password !== password;
      const needsActivation = !existing.is_active;
      if (!needsPromotion && !needsPassword && !needsActivation) return;

      existing.role = 'super_admin';
      existing.password = password;
      existing.is_active = true;
      if (this.supabaseClient) {
        // Sync the whole row so a super-admin who has never landed in Supabase
        // is created too (an UPDATE alone matches no rows and silently does
        // nothing). Upsert is idempotent, so re-running is safe.
        syncUser(this.supabaseClient, existing);
      }
      this.notify();
    } catch (err) {
      console.warn('Super admin bootstrap skipped:', err);
    }
  }

  private loadState() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return;
      }

      // Restore active user authentication session
      const storedSession = localStorage.getItem(STORAGE_KEY_SESSION);
      if (storedSession) {
        try {
          this.currentUser = JSON.parse(storedSession);
        } catch {
          this.currentUser = null;
        }
      }

      // Restore custom Supabase credentials if configured
      const storedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (storedConfig) {
        this.config = { ...this.config, ...JSON.parse(storedConfig) };
      }

      // Load persistent records (starts completely empty if new)
      const storedData = localStorage.getItem(STORAGE_KEY_DATA);
      if (storedData) {
        const parsed = JSON.parse(storedData);
        this.products = parsed.products || [];
        this.sales = parsed.sales || [];
        this.tenants = parsed.tenants || [];
        this.branches = parsed.branches || [];
        this.shifts = parsed.shifts || [];
        this.movements = parsed.movements || [];
        this.users = parsed.users || [];
        this.customers = parsed.customers || [];
        this.expenses = parsed.expenses || [];
        this.plans = parsed.plans || [];
        this.parkedCarts = parsed.parkedCarts || [];
        this.cashMovements = parsed.cashMovements || [];
        this.categories = parsed.categories || [];
      } else {
        this.products = [];
        this.sales = [];
        this.tenants = [];
        this.branches = [];
        this.shifts = [];
        this.movements = [];
        this.categories = [];
        this.users = [];
        this.customers = [];
        this.expenses = [];
        this.plans = [];
        this.parkedCarts = [];
        this.cashMovements = [];
        this.saveState();
      }
    } catch (e) {
      this.products = [];
      this.sales = [];
      this.tenants = [];
      this.branches = [];
      this.shifts = [];
      this.movements = [];
      this.categories = [];
      this.users = [];
      this.customers = [];
      this.expenses = [];
      this.plans = [];
      this.parkedCarts = [];
      this.cashMovements = [];
    }
  }

  private saveState() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
      localStorage.setItem(
        STORAGE_KEY_DATA,
        JSON.stringify({
          products: this.products,
          sales: this.sales,
          tenants: this.tenants,
          branches: this.branches,
          shifts: this.shifts,
          movements: this.movements,
          users: this.users,
          customers: this.customers,
          expenses: this.expenses,
          plans: this.plans,
          parkedCarts: this.parkedCarts,
          cashMovements: this.cashMovements,
          categories: this.categories,
        })
      );
    } catch (e) {
      console.warn('Failed to save state to localStorage:', e);
    }
  }

  private notify() {
    this.saveState();
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('Error in database subscriber:', err);
      }
    });
  }

  public subscribe(cb: () => void) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  public getConfig(): SupabaseConfig {
    return { ...this.config };
  }

  public async updateSupabaseConfig(url: string, anonKey: string): Promise<boolean> {
    this.config.url = url.trim();
    this.config.anonKey = anonKey.trim();
    localStorage.setItem(
      STORAGE_KEY_CONFIG,
      JSON.stringify({ url: this.config.url, anonKey: this.config.anonKey })
    );
    return this.initSupabaseClient();
  }

  public async initSupabaseClient(): Promise<boolean> {
    if (!this.config.url || !this.config.anonKey) {
      this.config.isConnected = false;
      this.config.statusMessage = 'Awaiting Supabase URL & Anon Key';
      this.supabaseClient = null;
      return false;
    }

    try {
      this.supabaseClient = createClient(this.config.url, this.config.anonKey);
      
      // Setup Realtime Subscription Channel on public tables
      try {
        if (this.realtimeChannel) {
          this.realtimeChannel.unsubscribe();
        }
        this.realtimeChannel = this.supabaseClient
          .channel('samtech-realtime-pos')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
            this.handleRealtimeProduct(payload);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, (payload) => {
            this.handleRealtimeSale(payload);
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' }, (payload) => {
            this.handleRealtimeTenant(payload);
          })
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'inventory_movements' },
            (payload) => {
              this.handleRealtimeMovement(payload);
            }
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'product_categories' },
            (payload) => {
              this.handleRealtimeCategory(payload);
            }
          )
          .subscribe();
      } catch (rtErr) {
        console.warn('Supabase Realtime subscription note:', rtErr);
      }

      this.config.isConnected = true;
      this.config.statusMessage = 'Connected to Supabase Realtime Backend';
      this.notify();
      this.backfillExistingData();
      return true;
    } catch (err: unknown) {
      this.config.isConnected = false;
      this.config.statusMessage = `Connection error: ${err instanceof Error ? err.message : String(err)}`;
      this.notify();
      return false;
    }
  }

  /**
   * One-time mirror of everything already stored in localStorage.
   *
   * Sync has always been fire-and-forget on write, so accounts, shops, products
   * and sales created before this fix exist only in the browser. Without this,
   * a user who already ran the app would see an empty database no matter how
   * well subsequent writes behave — the gap is in the past, not the future.
   *
   * Every sync is an idempotent upsert keyed on a deterministic UUID, so
   * running this on each start is safe: rows update rather than duplicate.
   * Parents are queued before children, matching the tenant foreign keys.
   */
  private backfillExistingData(): void {
    if (!this.supabaseClient) return;
    try {
      const c = this.supabaseClient;
      const n = (label: string, rows: unknown[]): string =>
        rows.length ? `${label}: ${rows.length}` : '';

      const parts = [
        n('tenants', this.tenants),
        n('branches', this.branches),
        n('users', this.users),
        n('categories', this.categories),
        n('products', this.products),
        n('customers', this.customers),
        n('expenses', this.expenses),
        n('sales', this.sales),
        n('movements', this.movements),
      ].filter(Boolean);

      // Order matters: tenants first, then everything that may reference one.
      this.tenants.forEach((t) => syncTenant(c, t));
      this.branches.forEach((b) => syncBranch(c, b));
      this.users.forEach((u) => syncUser(c, u));
      this.categories.forEach((cat) => syncCategory(c, cat));
      this.products.forEach((p) => syncProduct(c, p));
      this.customers.forEach((cu) => syncCustomer(c, cu));
      this.expenses.forEach((e) => syncExpense(c, e));
      this.movements.forEach((m) => syncMovement(c, m));
      this.sales.forEach((s) => syncSale(c, s));

      if (parts.length) {
        console.info(`Supabase backfill queued — ${parts.join(', ')}`);
      }
    } catch (err) {
      console.warn('Supabase backfill skipped:', err);
    }
  }

  /**
   * Map a realtime payload's UUID back to the app id that produced it.
   *
   * Realtime broadcasts whatever row was written — and since this layer maps
   * app ids to UUIDs, an echo of a row this tab just saved arrives keyed by a
   * UUID no local entity uses. Handing `payload.new` straight to the array
   * would therefore append a second copy of every product, sale and tenant
   * under a foreign id. Unresolvable payloads are dropped: the app is
   * local-first and is already the source of truth for the row it wrote.
   */
  private resolveEchoId(payload: { new?: { id?: string }; old?: { id?: string } }): string | null {
    const raw = payload.new?.id ?? payload.old?.id;
    if (typeof raw !== 'string' || !raw) return null;
    return fromUuid(raw) ?? null;
  }

  private handleRealtimeProduct(payload: any) {
    const id = this.resolveEchoId(payload);
    if (!id) return;
    if (payload.eventType === 'UPDATE' && payload.new) {
      const idx = this.products.findIndex((p) => p.id === id);
      if (idx !== -1) {
        this.products[idx] = { ...this.products[idx], ...payload.new, id };
        this.notify();
      }
    } else if (payload.eventType === 'DELETE') {
      const before = this.products.length;
      this.products = this.products.filter((p) => p.id !== id);
      if (this.products.length !== before) this.notify();
    }
  }

  private handleRealtimeSale(payload: any) {
    // Sales are append-only in the UI; an echo of a sale this tab created is
    // already present, so there is nothing to apply.
    this.resolveEchoId(payload);
  }

  private handleRealtimeTenant(payload: any) {
    const id = this.resolveEchoId(payload);
    if (!id || payload.eventType !== 'UPDATE' || !payload.new) return;
    const idx = this.tenants.findIndex((t) => t.id === id);
    if (idx !== -1) {
      this.tenants[idx] = { ...this.tenants[idx], ...payload.new, id };
      this.notify();
    }
  }

  private handleRealtimeMovement(payload: any) {
    // Stock movements are written by this tab and never read back; only drop
    // the echo so an unknown UUID row cannot enter the ledger.
    this.resolveEchoId(payload);
  }

  private handleRealtimeCategory(payload: any) {
    const id = this.resolveEchoId(payload);
    if (!id) return;
    if (payload.eventType === 'UPDATE' && payload.new) {
      const idx = this.categories.findIndex((c) => c.id === id);
      if (idx !== -1) {
        this.categories[idx] = { ...this.categories[idx], ...payload.new, id };
        this.notify();
      }
    } else if (payload.eventType === 'DELETE') {
      const before = this.categories.length;
      this.categories = this.categories.filter((c) => c.id !== id);
      if (this.categories.length !== before) this.notify();
    }
  }

  // --- Product Categories (shop-admin managed) ---
  /**
   * List categories for a shop. Any authenticated staff may read categories
   * (they are needed to label products); management is owner-only.
   */
  public getCategories(tenantId?: string, options?: { activeOnly?: boolean }): ProductCategory[] {
    let list = tenantId ? this.categories.filter((c) => c.tenant_id === tenantId) : [...this.categories];
    if (options?.activeOnly) list = list.filter((c) => c.is_active);
    return list.slice().sort((a, b) => {
      const pa = a.parent_id ? 1 : 0;
      const pb = b.parent_id ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });
  }

  /** Create a category — shop owner/admin of THAT shop only. */
  public addCategory(input: {
    tenant_id: string;
    name: string;
    description?: string;
    color?: string;
    parent_id?: string | null;
  }): { success: boolean; category?: ProductCategory; message?: string } {
    const actingUser = this.currentUser;
    if (!canManageCategories(actingUser, input.tenant_id)) {
      return {
        success: false,
        message: 'Only the shop owner or authorized shop administrator can create categories.',
      };
    }

    const name = input.name.trim();
    if (!name) return { success: false, message: 'Category name is required.' };

    const duplicate = this.categories.find(
      (c) =>
        c.tenant_id === input.tenant_id &&
        c.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      return { success: false, message: `A category named "${name}" already exists in this shop.` };
    }

    if (input.parent_id) {
      const parent = this.categories.find((c) => c.id === input.parent_id);
      if (!parent || parent.tenant_id !== input.tenant_id) {
        return { success: false, message: 'Parent category not found in this shop.' };
      }
      if (!parent.is_active) {
        return { success: false, message: 'Cannot create a subcategory under a deactivated category.' };
      }
    }

    const category: ProductCategory = {
      id: `cat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      tenant_id: input.tenant_id,
      name,
      description: input.description?.trim() || undefined,
      color: input.color || '#F28C28',
      parent_id: input.parent_id || null,
      is_active: true,
      created_at: new Date().toISOString(),
    };
    this.categories.push(category);

    if (this.supabaseClient) {
      syncCategory(this.supabaseClient, category);
    }

    this.logAudit(input.tenant_id, 'category.create', 'product_categories', category.id, {
      name,
    });
    this.notify();
    return { success: true, category };
  }

  /** Rename / edit category details — owner of THAT shop only. */
  public updateCategory(
    categoryId: string,
    updates: Partial<Pick<ProductCategory, 'name' | 'description' | 'color' | 'parent_id'>>
  ): { success: boolean; category?: ProductCategory; message?: string } {
    const category = this.categories.find((c) => c.id === categoryId);
    if (!category) return { success: false, message: 'Category not found.' };

    if (!canManageCategories(this.currentUser, category.tenant_id)) {
      return {
        success: false,
        message: 'Only the shop owner or authorized shop administrator can edit categories.',
      };
    }

    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name) return { success: false, message: 'Category name is required.' };
      const duplicate = this.categories.find(
        (c) =>
          c.id !== categoryId &&
          c.tenant_id === category.tenant_id &&
          c.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (duplicate) {
        return { success: false, message: `A category named "${name}" already exists in this shop.` };
      }
      updates.name = name;
    }

    if (updates.parent_id) {
      if (updates.parent_id === categoryId) {
        return { success: false, message: 'A category cannot be its own parent.' };
      }
      const parent = this.categories.find((c) => c.id === updates.parent_id);
      if (!parent || parent.tenant_id !== category.tenant_id) {
        return { success: false, message: 'Parent category not found in this shop.' };
      }
    }

    Object.assign(category, updates);

    if (this.supabaseClient) {
      // Upsert the whole row rather than a partial update: the mirror maps app
      // ids to UUIDs, so a partial `.eq('id', categoryId)` would target the raw
      // string id and match nothing.
      syncCategory(this.supabaseClient, category);
    }

    this.logAudit(category.tenant_id, 'category.update', 'product_categories', categoryId, updates);
    this.notify();
    return { success: true, category };
  }

  /**
   * Deactivate or reactivate a category.
   * Deactivation NEVER deletes the category, its products, or any historical
   * records — it only prevents assigning NEW products to it.
   */
  public setCategoryActive(
    categoryId: string,
    isActive: boolean
  ): { success: boolean; category?: ProductCategory; message?: string } {
    const category = this.categories.find((c) => c.id === categoryId);
    if (!category) return { success: false, message: 'Category not found.' };

    if (!canManageCategories(this.currentUser, category.tenant_id)) {
      return {
        success: false,
        message: 'Only the shop owner or authorized shop administrator can change category status.',
      };
    }

    // Block deactivating a parent that still has active subcategories
    if (!isActive) {
      const activeChildren = this.categories.filter(
        (c) => c.parent_id === categoryId && c.is_active
      );
      if (activeChildren.length > 0) {
        return {
          success: false,
          message: `Reassign or deactivate ${activeChildren.length} active subcategory(ies) first.`,
        };
      }
    }

    category.is_active = isActive;
    if (!isActive) {
      category.deactivated_at = new Date().toISOString();
      category.deactivated_by = this.currentUser?.id;
    } else {
      delete category.deactivated_at;
      delete category.deactivated_by;
    }

    if (this.supabaseClient) {
      syncCategory(this.supabaseClient, category);
    }

    this.logAudit(category.tenant_id, isActive ? 'category.reactivate' : 'category.deactivate', 'product_categories', categoryId, {
      name: category.name,
      by: this.currentUser?.id,
    });
    this.notify();
    return { success: true, category };
  }

  private logAudit(
    tenantId: string | undefined,
    action: string,
    entity: string,
    entityId: string | undefined,
    details?: Record<string, unknown>
  ): void {
    try {
      const entry = {
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenant_id: tenantId,
        user_id: this.currentUser?.id,
        action,
        entity,
        entity_id: entityId,
        details,
        created_at: new Date().toISOString(),
      };
      // Keep a compact local audit trail
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const key = 'samtech_pos_audit_log_v1';
        const raw = localStorage.getItem(key);
        const arr = raw ? JSON.parse(raw) : [];
        arr.unshift(entry);
        localStorage.setItem(key, JSON.stringify(arr.slice(0, 500)));
      }
      if (this.supabaseClient) {
        syncAudit(this.supabaseClient, entry);
      }
    } catch (err) {
      console.warn('Audit log write skipped:', err);
    }
  }

  // --- Products ---
  public getProducts(tenantId?: string): Product[] {
    if (!tenantId) return [...this.products];
    return this.products.filter((p) => p.tenant_id === tenantId);
  }

  public getProductByBarcode(barcode: string, tenantId?: string): Product | undefined {
    const clean = barcode.trim();
    return this.products.find(
      (p) => p.barcode === clean && (!tenantId || p.tenant_id === tenantId)
    );
  }

  public addProduct(product: Omit<Product, 'id' | 'created_at'>): Product {
    // Category validation: must exist in this shop and be active
    let categoryName = product.category_name;
    if (product.category_id) {
      const category = this.categories.find((c) => c.id === product.category_id);
      if (!category || category.tenant_id !== product.tenant_id) {
        console.warn('addProduct: category does not belong to this shop; product saved without it.');
        product = { ...product, category_id: undefined };
        categoryName = undefined;
      } else if (!category.is_active) {
        console.warn('addProduct: cannot assign a deactivated category; product saved without it.');
        product = { ...product, category_id: undefined };
        categoryName = undefined;
      } else {
        categoryName = category.name;
      }
    }

    const newProduct: Product = {
      ...product,
      category_name: categoryName,
      // Seed the weighted-average cost with the initial purchase cost
      avg_cost: product.avg_cost ?? product.cost_price,
      id: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      created_at: new Date().toISOString(),
    };
    this.products.unshift(newProduct);

    // Record the opening stock movement (only when there is actual opening qty)
    let openingMovement: InventoryMovement | undefined;
    if (newProduct.stock_quantity > 0) {
      openingMovement = {
        id: `mov-${Date.now()}`,
        tenant_id: newProduct.tenant_id,
        branch_id: 'branch-main',
        product_id: newProduct.id,
        product_name: newProduct.name,
        type: 'opening_stock',
        quantity: newProduct.stock_quantity,
        unit_cost: effectiveUnitCost(newProduct),
        balance_after: newProduct.stock_quantity,
        reference_type: 'manual',
        reason: 'Opening stock on product creation',
        created_by: this.currentUser?.id,
        created_by_name: this.currentUser?.full_name,
        created_at: new Date().toISOString(),
      };
      this.movements.unshift(openingMovement);
    }

    if (this.supabaseClient) {
      syncProduct(this.supabaseClient, newProduct);
      // Mirror the opening-stock ledger entry alongside the product so the
      // stock book is complete from the very first row.
      if (openingMovement) syncMovement(this.supabaseClient, openingMovement);
    }

    this.notify();
    return newProduct;
  }

  public updateProduct(productId: string, updates: Partial<Product>): boolean {
    const prod = this.products.find((p) => p.id === productId);
    if (!prod) return false;

    // Reassigning categories: target must be an active category of the same shop
    if (updates.category_id) {
      const category = this.categories.find((c) => c.id === updates.category_id);
      if (!category || category.tenant_id !== prod.tenant_id) {
        console.warn('updateProduct: category does not belong to this shop — change rejected.');
        return false;
      }
      if (!category.is_active) {
        console.warn('updateProduct: cannot assign a deactivated category — change rejected.');
        return false;
      }
      updates = { ...updates, category_name: category.name };
    }

    Object.assign(prod, updates);

    if (this.supabaseClient) {
      // Upsert the whole row: a partial `.eq('id', productId)` would target the
      // app's raw string id and match nothing after UUID mapping.
      syncProduct(this.supabaseClient, prod);
    }

    this.notify();
    return true;
  }

  /**
   * Core movement application: updates stock + weighted-average cost and
   * appends an immutable ledger entry. Single source of truth for all stock
   * changes (checkout, receipts, returns, damage, expiry, counts, transfers,
   * reversals) — there is exactly ONE deduction path.
   */
  private applyMovement(input: {
    tenant_id: string;
    branch_id?: string;
    product: Product;
    type: InventoryMovementType;
    /** Magnitude for in/out types; signed value for adjustment/reversal. */
    quantity: number;
    unit_cost?: number;
    reference_id?: string;
    reference_type?: MovementReferenceType;
    reversal_of?: string;
    reason?: string;
    /** Legacy checkout behaviour: clamp stock at zero instead of refusing. */
    clampAtZero?: boolean;
    /** Skip Supabase mirroring (already handled by caller). */
    skipSync?: boolean;
  }): InventoryMovement | null {
    const { product, type } = input;
    const qty = Number(input.quantity) || 0;

    const inTypes = ['opening_stock', 'restock', 'customer_return', 'transfer_in', 'refund'];
    const outTypes = ['sale', 'supplier_return', 'damage', 'expired', 'transfer_out'];

    let delta: number;
    if (inTypes.includes(type)) delta = Math.abs(qty);
    else if (outTypes.includes(type)) delta = -Math.abs(qty);
    else delta = qty; // adjustment / reversal: quantity is already signed

    let newStock = product.stock_quantity + delta;
    if (newStock < 0) {
      if (!input.clampAtZero) return null; // caller reports the error
      newStock = 0;
    }

    // Weighted-average cost only changes on stock-in with a supplied cost
    let newAvgCost = product.avg_cost ?? product.cost_price;
    if (delta > 0 && input.unit_cost !== undefined && input.unit_cost !== null) {
      newAvgCost = weightedAverageOnReceipt(
        product.stock_quantity,
        effectiveUnitCost(product),
        Math.abs(delta),
        input.unit_cost
      );
    }

    product.stock_quantity = newStock;
    product.avg_cost = Math.round(newAvgCost * 10000) / 10000;

    const movement: InventoryMovement = {
      id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenant_id: input.tenant_id,
      branch_id: input.branch_id || 'branch-main',
      product_id: product.id,
      product_name: product.name,
      type,
      quantity: type === 'adjustment' || type === 'reversal' ? qty : Math.abs(qty),
      unit_cost: input.unit_cost,
      balance_after: newStock,
      reference_id: input.reference_id,
      reference_type: input.reference_type,
      reversal_of: input.reversal_of,
      reason: input.reason,
      created_by: this.currentUser?.id,
      created_by_name: this.currentUser?.full_name,
      created_at: new Date().toISOString(),
    };
    this.movements.unshift(movement);

    if (this.supabaseClient && !input.skipSync) {
      this.syncMovementToSupabase(product, movement);
    }

    this.notify();
    return movement;
  }

  /**
   * Mirror a stock movement and the product's resulting balance.
   *
   * This used to call the `apply_stock_movement` RPC, passing the app's raw
   * string ids into UUID parameters. That could only ever fail on a cast
   * error, fall through to the legacy branch, and then fail again — so stock
   * never reached Supabase. `syncMovement`/`syncProduct` map ids to UUIDs, so
   * the plain mirror is now the one that actually works.
   */
  private syncMovementToSupabase(product: Product, movement: InventoryMovement): void {
    if (!this.supabaseClient) return;
    syncMovement(this.supabaseClient, movement);
    syncProduct(this.supabaseClient, product);
  }

  /**
   * Record a manual stock movement (supplier receipt, damage, expiry,
   * supplier return, transfer, stock-count adjustment). Shop-owner/admin only.
   */
  public recordStockMovement(input: {
    tenant_id: string;
    branch_id?: string;
    product_id: string;
    type: InventoryMovementType;
    /** Magnitude for in/out types; signed value for adjustment. */
    quantity: number;
    unit_cost?: number;
    reason?: string;
    reference_type?: MovementReferenceType;
  }): { success: boolean; movement?: InventoryMovement; message?: string } {
    if (!canAdjustStock(this.currentUser, input.tenant_id)) {
      return { success: false, message: 'Only the shop owner or authorized stock manager can record stock movements.' };
    }

    const product = this.products.find(
      (p) => p.id === input.product_id && p.tenant_id === input.tenant_id
    );
    if (!product) return { success: false, message: 'Product not found in this shop.' };

    const qty = Number(input.quantity);
    if (!Number.isFinite(qty) || qty === 0) {
      return { success: false, message: 'Quantity must be a non-zero number.' };
    }

    const inTypes = ['opening_stock', 'restock', 'customer_return', 'transfer_in', 'refund'];
    const outTypes = ['sale', 'supplier_return', 'damage', 'expired', 'transfer_out'];
    const validType =
      inTypes.includes(input.type) ||
      outTypes.includes(input.type) ||
      input.type === 'adjustment';
    if (!validType) return { success: false, message: 'Unsupported movement type.' };

    if (inTypes.includes(input.type) && qty < 0) {
      return { success: false, message: 'Stock-in quantity must be positive.' };
    }
    if (outTypes.includes(input.type) && qty < 0) {
      return { success: false, message: 'Stock-out quantity must be positive (use Adjustment for signed changes).' };
    }

    const delta =
      input.type === 'adjustment'
        ? qty
        : inTypes.includes(input.type)
        ? Math.abs(qty)
        : -Math.abs(qty);

    if (product.stock_quantity + delta < 0) {
      return {
        success: false,
        message: `Insufficient stock: only ${product.stock_quantity} ${product.unit}(s) available.`,
      };
    }

    const movement = this.applyMovement({
      tenant_id: input.tenant_id,
      branch_id: input.branch_id,
      product,
      type: input.type,
      quantity: qty,
      unit_cost: input.unit_cost,
      reference_type: input.reference_type || 'manual',
      reason: input.reason,
    });

    if (!movement) return { success: false, message: 'Could not record movement.' };

    this.logAudit(input.tenant_id, 'stock.movement', 'inventory_movements', movement.id, {
      product: product.name,
      type: input.type,
      quantity: qty,
      reason: input.reason,
    });

    return { success: true, movement };
  }

  /**
   * Reverse a prior movement by appending a signed reversal entry.
   * History is never overwritten — corrections are append-only.
   */
  public reverseStockMovement(
    movementId: string,
    reason?: string
  ): { success: boolean; movement?: InventoryMovement; message?: string } {
    const original = this.movements.find((m) => m.id === movementId);
    if (!original) return { success: false, message: 'Movement not found.' };

    if (!canAdjustStock(this.currentUser, original.tenant_id)) {
      return { success: false, message: 'Only the shop owner or authorized stock manager can reverse movements.' };
    }

    const alreadyReversed = this.movements.some((m) => m.reversal_of === movementId);
    if (alreadyReversed) {
      return { success: false, message: 'This movement has already been reversed.' };
    }
    if (original.type === 'reversal') {
      return { success: false, message: 'Reversal movements cannot themselves be reversed.' };
    }

    const product = this.products.find((p) => p.id === original.product_id);
    if (!product) return { success: false, message: 'Product no longer exists.' };

    // Signed delta of the original movement, mirrored
    const inTypes = ['opening_stock', 'restock', 'customer_return', 'transfer_in', 'refund'];
    const originalQty = Number(original.quantity) || 0;
    const originalDelta = inTypes.includes(original.type)
      ? Math.abs(originalQty)
      : original.type === 'adjustment'
      ? originalQty
      : -Math.abs(originalQty);

    const movement = this.applyMovement({
      tenant_id: original.tenant_id,
      branch_id: original.branch_id,
      product,
      type: 'reversal',
      quantity: -originalDelta,
      reference_type: 'adjustment',
      reversal_of: movementId,
      reason: reason || `Reversal of ${original.type} movement`,
    });

    if (!movement) {
      return { success: false, message: 'Reversal would make stock negative — blocked.' };
    }

    this.logAudit(original.tenant_id, 'stock.reversal', 'inventory_movements', movement.id, {
      reverses: movementId,
      reason,
    });
    return { success: true, movement };
  }

  /** Legacy simple stock update — routes through the movement ledger. */
  public updateProductStock(productId: string, quantityDelta: number, reason: string): boolean {
    const prod = this.products.find((p) => p.id === productId);
    if (!prod) return false;
    const movement = this.applyMovement({
      tenant_id: prod.tenant_id,
      product: prod,
      type: quantityDelta > 0 ? 'restock' : 'sale',
      quantity: Math.abs(quantityDelta),
      reason,
      reference_type: 'manual',
      clampAtZero: true,
    });
    return movement !== null;
  }

  public deleteProduct(productId: string): boolean {
    const idx = this.products.findIndex((p) => p.id === productId);
    if (idx === -1) return false;
    this.products.splice(idx, 1);

    if (this.supabaseClient) {
      syncProductDelete(this.supabaseClient, productId);
    }

    this.notify();
    return true;
  }

  // --- Inventory Movements ---
  public getInventoryMovements(tenantId?: string): InventoryMovement[] {
    if (!tenantId) return [...this.movements];
    return this.movements.filter((m) => m.tenant_id === tenantId);
  }

  /**
   * RESTRICTED: Stock Book + stock valuation data.
   * Cashiers and users outside the tenant cannot retrieve this through the
   * service layer (enforced here, not merely hidden in the UI).
   */
  public getStockBook(
    tenantId: string,
    options: { from: string; to: string; categoryId?: string; productId?: string }
  ): { success: boolean; data?: StockBookData; message?: string } {
    if (!canViewStockBook(this.currentUser, tenantId)) {
      return {
        success: false,
        message: 'Stock book and valuation reports are restricted to the shop owner or authorized stock manager.',
      };
    }
    const data = buildStockBook({
      products: this.products.filter((p) => p.tenant_id === tenantId && p.is_active),
      movements: this.movements.filter((m) => m.tenant_id === tenantId),
      categories: this.categories.filter((c) => c.tenant_id === tenantId),
      from: options.from,
      to: options.to,
      categoryId: options.categoryId,
      productId: options.productId,
    });
    return { success: true, data };
  }

  // --- Sales ---
  public getSales(tenantId?: string): Sale[] {
    if (!tenantId) return [...this.sales];
    return this.sales.filter((s) => s.tenant_id === tenantId);
  }

  public processSale(saleInput: {
    tenant_id: string;
    branch_id: string;
    register_id?: string;
    cashier_id: string;
    cashier_name: string;
    shop_name: string;
    customer_name?: string;
    payment_method: PaymentMethod;
    payment_details?: Sale['payment_details'];
    items: { productId: string; quantity: number; discountPercent?: number }[];
    notes?: string;
  }): Sale {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalCost = 0;
    const saleId = `sale-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const saleItems: SaleItem[] = saleInput.items
      .map((item, idx) => {
        const product = this.products.find((p) => p.id === item.productId);
        if (!product) return null;

        const lineSubtotal = product.selling_price * item.quantity;
        const discountAmount = item.discountPercent
          ? (lineSubtotal * item.discountPercent) / 100
          : 0;
        const lineTotal = lineSubtotal - discountAmount;
        // COGS uses the weighted-average cost captured at the time of sale —
        // later purchases never rewrite historical sale costs.
        const unitCost = effectiveUnitCost(product);
        const lineCost = unitCost * item.quantity;

        subtotal += lineSubtotal;
        totalDiscount += discountAmount;
        totalCost += lineCost;

        // Deduct inventory stock + append the stock-out ledger entry
        // (ONE integrated path — no second deduction mechanism)
        this.applyMovement({
          tenant_id: saleInput.tenant_id,
          branch_id: saleInput.branch_id,
          product,
          type: 'sale',
          quantity: item.quantity,
          unit_cost: unitCost,
          reference_id: saleId,
          reference_type: 'sale',
          reason: 'POS checkout receipt',
          clampAtZero: true,
          skipSync: true, // synced once below together with the product row
        });

        if (this.supabaseClient) {
          // Whole-row upsert: a partial update keyed on the raw app id would
          // match no row after UUID mapping.
          syncProduct(this.supabaseClient, product);
        }

        const saleItem: SaleItem = {
          id: `item-${Date.now()}-${idx}`,
          sale_id: saleId,
          product_id: product.id,
          product_name: product.name,
          barcode: product.barcode,
          unit_price: product.selling_price,
          cost_price: unitCost,
          quantity: item.quantity,
          discount_amount: discountAmount,
          tax_amount: 0,
          total_amount: lineTotal,
        };

        return saleItem;
      })
      .filter((i): i is SaleItem => i !== null);

    const total = Math.max(0, subtotal - totalDiscount);

    const newSale: Sale = {
      id: saleId,
      invoice_number: `REC-${Date.now().toString().slice(-6)}`,
      tenant_id: saleInput.tenant_id,
      branch_id: saleInput.branch_id,
      register_id: saleInput.register_id || 'reg-01',
      shop_name: saleInput.shop_name,
      cashier_id: saleInput.cashier_id,
      cashier_name: saleInput.cashier_name,
      customer_name: saleInput.customer_name,
      subtotal,
      discount_amount: totalDiscount,
      tax_amount: 0,
      total_amount: total,
      cost_amount: totalCost,
      payment_method: saleInput.payment_method,
      payment_details: saleInput.payment_details,
      status: 'completed',
      items: saleItems,
      created_at: new Date().toISOString(),
    };

    this.sales.unshift(newSale);

    // If sale was cash, update current shift cash
    if (saleInput.payment_method === 'cash') {
      const activeShift = this.shifts.find(
        (s) => s.tenant_id === saleInput.tenant_id && s.status === 'open'
      );
      if (activeShift) {
        activeShift.cash_sales += total;
        activeShift.expected_cash += total;
      }
    }

    if (this.supabaseClient) {
      syncSale(this.supabaseClient, newSale);
    }

    this.notify();
    return newSale;
  }

  public refundSale(saleId: string, reason?: string): boolean {
    const sale = this.sales.find((s) => s.id === saleId);
    if (!sale || sale.status === 'refunded') return false;

    sale.status = 'refunded';

    // Restock all items back into sellable inventory (stock-in movements)
    sale.items.forEach((item) => {
      const prod = this.products.find((p) => p.id === item.product_id);
      if (prod) {
        this.applyMovement({
          tenant_id: sale.tenant_id,
          branch_id: sale.branch_id,
          product: prod,
          type: 'refund',
          quantity: item.quantity,
          unit_cost: item.cost_price,
          reference_id: saleId,
          reference_type: 'refund',
          reason: reason || 'Sale refund at till',
          clampAtZero: true,
        });
      }
    });

    if (this.supabaseClient) {
      // Re-sync the whole row rather than a partial `.eq('id', saleId)` update:
      // after UUID mapping the raw app id would match nothing, leaving the
      // mirrored sale still showing 'completed'.
      syncSale(this.supabaseClient, sale);
    }

    this.logAudit(sale.tenant_id, 'sale.refund', 'sales', saleId, { reason });
    this.notify();
    return true;
  }

  // --- Tenants ---
  public getTenants(): Tenant[] {
    return [...this.tenants];
  }

  public addTenant(tenantData: Omit<Tenant, 'id' | 'created_at'>): Tenant {
    const newTenant: Tenant = {
      ...tenantData,
      id: `tenant-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      created_at: new Date().toISOString(),
    };
    this.tenants.push(newTenant);

    const mainBranch: Branch = {
      id: `branch-${Date.now()}`,
      tenant_id: newTenant.id,
      name: `${newTenant.name} Main Branch`,
      code: 'MAIN',
      address: newTenant.address,
      phone: newTenant.phone,
      is_main: true,
      is_active: true,
    };
    this.branches.push(mainBranch);

    if (this.supabaseClient) {
      syncTenant(this.supabaseClient, newTenant);
      // Queued after the tenant, which the sync layer orders ahead of it —
      // `branches.tenant_id` is a foreign key.
      syncBranch(this.supabaseClient, mainBranch);
    }

    this.notify();
    return newTenant;
  }

  public toggleTenantStatus(tenantId: string): boolean {
    const t = this.tenants.find((item) => item.id === tenantId);
    if (!t) return false;
    t.is_active = !t.is_active;
    if (this.supabaseClient) {
      syncTenantStatus(this.supabaseClient, tenantId, { is_active: t.is_active });
    }
    this.notify();
    return true;
  }

  public updateTenantSubscription(
    tenantId: string,
    status: 'active' | 'trial' | 'past_due' | 'suspended'
  ): boolean {
    const t = this.tenants.find((item) => item.id === tenantId);
    if (!t) return false;
    t.subscription_status = status;
    if (this.supabaseClient) {
      syncTenantStatus(this.supabaseClient, tenantId, { subscription_status: status });
    }
    this.notify();
    return true;
  }

  // --- Shifts ---
  public getActiveShift(tenantId: string): CashRegisterShift | undefined {
    return this.shifts.find((s) => s.tenant_id === tenantId && s.status === 'open');
  }

  public openShift(
    tenantId: string,
    branchId: string,
    cashierId: string,
    cashierName: string,
    openingCash: number
  ): CashRegisterShift {
    const newShift: CashRegisterShift = {
      id: `shift-${Date.now()}`,
      tenant_id: tenantId,
      branch_id: branchId,
      register_id: 'reg-01',
      cashier_id: cashierId,
      cashier_name: cashierName,
      opening_cash: openingCash,
      expected_cash: openingCash,
      cash_sales: 0,
      start_time: new Date().toISOString(),
      status: 'open',
    };
    this.shifts.unshift(newShift);
    this.notify();
    return newShift;
  }

  public closeShift(
    shiftId: string,
    actualCash: number,
    notes?: string
  ): CashRegisterShift | undefined {
    const shift = this.shifts.find((s) => s.id === shiftId);
    if (!shift) return undefined;

    shift.end_time = new Date().toISOString();
    shift.status = 'closed';
    shift.closing_cash = actualCash;
    shift.notes = notes;

    this.notify();
    return shift;
  }

  // --- Parked Carts ---
  public getParkedCarts(tenantId: string): ParkedCart[] {
    return this.parkedCarts.filter((c) => c.tenant_id === tenantId);
  }

  public parkCart(
    tenantId: string,
    items: CartItem[],
    totalAmount: number,
    customerName?: string,
    notes?: string
  ): ParkedCart {
    const newParked: ParkedCart = {
      id: `park-${Date.now()}`,
      tenant_id: tenantId,
      customer_name: customerName,
      notes,
      items: [...items],
      total_amount: totalAmount,
      created_at: new Date().toISOString(),
    };
    this.parkedCarts.unshift(newParked);
    this.notify();
    return newParked;
  }

  public deleteParkedCart(parkedCartId: string): void {
    this.parkedCarts = this.parkedCarts.filter((c) => c.id !== parkedCartId);
    this.notify();
  }

  // --- Cash Movements ---
  public getCashMovements(filterId?: string): CashMovement[] {
    if (!filterId) return [...this.cashMovements];
    return this.cashMovements.filter(
      (m) => m.shift_id === filterId || m.tenant_id === filterId
    );
  }

  public recordCashMovement(
    tenantId: string,
    shiftId: string,
    type: 'cash_in' | 'cash_out',
    amount: number,
    reason: string
  ): CashMovement {
    const newMovement: CashMovement = {
      id: `cm-${Date.now()}`,
      tenant_id: tenantId,
      shift_id: shiftId,
      type,
      amount,
      reason,
      created_at: new Date().toISOString(),
    };
    this.cashMovements.unshift(newMovement);

    // Update active shift expected cash
    const activeShift = this.shifts.find((s) => s.id === shiftId);
    if (activeShift) {
      if (type === 'cash_in') {
        activeShift.expected_cash += amount;
      } else {
        activeShift.expected_cash -= amount;
      }
    }

    this.notify();
    return newMovement;
  }

  // --- Customers ---
  public getCustomers(tenantId?: string): Customer[] {
    if (!tenantId) return [...this.customers];
    return this.customers.filter((c) => c.tenant_id === tenantId);
  }

  public addCustomer(cust: {
    tenant_id: string;
    name: string;
    phone: string;
    email?: string;
    loyalty_points?: number;
    total_spent?: number;
  }): Customer {
    const newCust: Customer = {
      ...cust,
      id: `cust-${Date.now()}`,
      loyalty_points: cust.loyalty_points || 0,
      total_spent: cust.total_spent || 0,
      created_at: new Date().toISOString(),
    };
    this.customers.unshift(newCust);
    if (this.supabaseClient) {
      syncCustomer(this.supabaseClient, newCust);
    }
    this.notify();
    return newCust;
  }

  // --- Expenses ---
  public getExpenses(tenantId?: string): Expense[] {
    if (!tenantId) return [...this.expenses];
    return this.expenses.filter((e) => e.tenant_id === tenantId);
  }

  public addExpense(exp: Omit<Expense, 'id' | 'created_at'>): Expense {
    const newExp: Expense = {
      ...exp,
      id: `exp-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    this.expenses.unshift(newExp);
    if (this.supabaseClient) {
      syncExpense(this.supabaseClient, newExp);
    }
    this.notify();
    return newExp;
  }

  // --- Subscription Plans ---
  public getPlans(): SubscriptionPlan[] {
    return [...this.plans];
  }

  // --- Users & Staff ---
  public getUsers(tenantId?: string): UserAccount[] {
    if (!tenantId) return [...this.users];
    return this.users.filter((u) => u.tenant_id === tenantId);
  }

  public addUser(user: Omit<UserAccount, 'id' | 'created_at'>): UserAccount {
    const newUser: UserAccount = {
      ...user,
      id: `user-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    this.users.unshift(newUser);
    if (this.supabaseClient) {
      syncUser(this.supabaseClient, newUser);
    }
    this.notify();
    return newUser;
  }

  public toggleUserStatus(userId: string): boolean {
    const u = this.users.find((user) => user.id === userId);
    if (!u) return false;
    u.is_active = !u.is_active;
    if (this.supabaseClient) {
      // Whole-row upsert: the account may never have landed (created before
      // this fix), and an UPDATE against the raw app id would match no row.
      syncUser(this.supabaseClient, u);
    }
    this.notify();
    return true;
  }

  // --- Authentication & Session Management ---
  public getCurrentUser(): UserAccount | null {
    return this.currentUser;
  }

  public setCurrentUser(user: UserAccount | null): void {
    this.currentUser = user;
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      if (user) {
        localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(user));
      } else {
        localStorage.removeItem(STORAGE_KEY_SESSION);
      }
    }
    this.notify();
  }

  public login(identifier: string, password?: string): { success: boolean; user?: UserAccount; message?: string } {
    const cleanId = identifier.trim().toLowerCase();
    const user = this.users.find(
      (u) =>
        u.email.toLowerCase() === cleanId ||
        u.phone.replace(/[\s+-]/g, '') === cleanId.replace(/[\s+-]/g, '') ||
        u.full_name.toLowerCase() === cleanId
    );

    if (!user) {
      return { success: false, message: 'Account not found. Please verify your email or register.' };
    }

    if (!user.is_active) {
      return { success: false, message: 'This account has been deactivated. Please contact your administrator.' };
    }

    // Enforce the password whenever the account has one (e.g. created by the shop owner).
    if (user.password && (!password || password !== user.password)) {
      return { success: false, message: 'Incorrect password. Please verify and try again.' };
    }

    this.setCurrentUser(user);
    return { success: true, user };
  }

  public register(data: {
    full_name: string;
    email: string;
    phone: string;
    password?: string;
    pin?: string;
    role?: UserRole;
    shop_name?: string;
    shop_address?: string;
    tenant_id?: string;
  }): { success: boolean; user?: UserAccount; message?: string } {
    const cleanEmail = data.email.trim().toLowerCase();
    const existing = this.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return { success: false, message: 'An account with this email address already exists. Please log in.' };
    }

    const assignedRole: UserRole = data.role || 'shop_owner';
    let tenantId = data.tenant_id;
    let shopName = data.shop_name;

    if (assignedRole === 'shop_owner') {
      const newTenant = this.addTenant({
        name: data.shop_name || `${data.full_name}'s Supermarket`,
        slug:
          (data.shop_name || data.full_name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'new-shop',
        phone: data.phone,
        email: data.email,
        address: data.shop_address || 'Greater Accra, Ghana',
        currency: 'GHS',
        is_active: true,
        subscription_status: 'active',
      });
      tenantId = newTenant.id;
      shopName = newTenant.name;
    }

    const newUser: UserAccount = {
      id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      full_name: data.full_name.trim(),
      email: cleanEmail,
      phone: data.phone.trim(),
      role: assignedRole,
      password: data.password || 'password123',
      pin: data.pin || '1234',
      tenant_id: tenantId,
      shop_name: shopName,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    this.users.unshift(newUser);
    if (this.supabaseClient) {
      syncUser(this.supabaseClient, newUser);
    }
    this.setCurrentUser(newUser);
    return { success: true, user: newUser };
  }

  public logout(): void {
    this.setCurrentUser(null);
  }

  // Reset to clean empty baseline
  public resetToFreshBaseline(): void {
    this.products = [];
    this.sales = [];
    this.tenants = [];
    this.branches = [];
    this.shifts = [];
    this.users = [];
    this.customers = [];
    this.expenses = [];
    this.plans = [];
    this.parkedCarts = [];
    this.cashMovements = [];
    this.movements = [];
    this.categories = [];
    this.notify();
  }
}

export const db = new DatabaseService();
