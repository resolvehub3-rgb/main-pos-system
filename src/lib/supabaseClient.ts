import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  Product,
  Sale,
  SaleItem,
  Tenant,
  Branch,
  CashRegisterShift,
  InventoryMovement,
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

// Environment variables for real Supabase deployment
const getEnvVar = (key: string): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  return '';
};

const ENV_SUPABASE_URL = getEnvVar('VITE_SUPABASE_URL');
const ENV_SUPABASE_ANON_KEY = getEnvVar('VITE_SUPABASE_ANON_KEY');

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
      } else {
        this.products = [];
        this.sales = [];
        this.tenants = [];
        this.branches = [];
        this.shifts = [];
        this.movements = [];
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
          .subscribe();
      } catch (rtErr) {
        console.warn('Supabase Realtime subscription note:', rtErr);
      }

      this.config.isConnected = true;
      this.config.statusMessage = 'Connected to Supabase Realtime Backend';
      this.notify();
      return true;
    } catch (err: unknown) {
      this.config.isConnected = false;
      this.config.statusMessage = `Connection error: ${err instanceof Error ? err.message : String(err)}`;
      this.notify();
      return false;
    }
  }

  private handleRealtimeProduct(payload: any) {
    if (payload.eventType === 'INSERT' && payload.new) {
      if (!this.products.find((p) => p.id === payload.new.id)) {
        this.products.unshift(payload.new);
        this.notify();
      }
    } else if (payload.eventType === 'UPDATE' && payload.new) {
      const idx = this.products.findIndex((p) => p.id === payload.new.id);
      if (idx !== -1) {
        this.products[idx] = payload.new;
        this.notify();
      }
    } else if (payload.eventType === 'DELETE' && payload.old) {
      this.products = this.products.filter((p) => p.id !== payload.old.id);
      this.notify();
    }
  }

  private handleRealtimeSale(payload: any) {
    if (payload.eventType === 'INSERT' && payload.new) {
      if (!this.sales.find((s) => s.id === payload.new.id)) {
        this.sales.unshift(payload.new);
        this.notify();
      }
    }
  }

  private handleRealtimeTenant(payload: any) {
    if (payload.eventType === 'INSERT' && payload.new) {
      if (!this.tenants.find((t) => t.id === payload.new.id)) {
        this.tenants.unshift(payload.new);
        this.notify();
      }
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
    const newProduct: Product = {
      ...product,
      id: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      created_at: new Date().toISOString(),
    };
    this.products.unshift(newProduct);

    // Record initial inventory movement
    this.movements.unshift({
      id: `mov-${Date.now()}`,
      tenant_id: newProduct.tenant_id,
      branch_id: 'branch-main',
      product_id: newProduct.id,
      product_name: newProduct.name,
      type: 'restock',
      quantity: newProduct.stock_quantity,
      reason: 'Initial stock intake',
      created_at: new Date().toISOString(),
    });

    if (this.supabaseClient) {
      this.supabaseClient.from('products').insert([newProduct]).then(({ error }) => {
        if (error) console.warn('Supabase product sync note:', error.message);
      });
    }

    this.notify();
    return newProduct;
  }

  public updateProduct(productId: string, updates: Partial<Product>): boolean {
    const prod = this.products.find((p) => p.id === productId);
    if (!prod) return false;
    Object.assign(prod, updates);

    if (this.supabaseClient) {
      this.supabaseClient.from('products').update(updates).eq('id', productId).then();
    }

    this.notify();
    return true;
  }

  public updateProductStock(productId: string, quantityDelta: number, reason: string): boolean {
    const prod = this.products.find((p) => p.id === productId);
    if (!prod) return false;
    prod.stock_quantity = Math.max(0, prod.stock_quantity + quantityDelta);

    this.movements.unshift({
      id: `mov-${Date.now()}`,
      tenant_id: prod.tenant_id,
      branch_id: 'branch-main',
      product_id: prod.id,
      product_name: prod.name,
      type: quantityDelta > 0 ? 'restock' : 'sale',
      quantity: Math.abs(quantityDelta),
      reason,
      created_at: new Date().toISOString(),
    });

    if (this.supabaseClient) {
      this.supabaseClient
        .from('products')
        .update({ stock_quantity: prod.stock_quantity })
        .eq('id', prod.id)
        .then();
    }

    this.notify();
    return true;
  }

  public deleteProduct(productId: string): boolean {
    const idx = this.products.findIndex((p) => p.id === productId);
    if (idx === -1) return false;
    this.products.splice(idx, 1);

    if (this.supabaseClient) {
      this.supabaseClient.from('products').delete().eq('id', productId).then();
    }

    this.notify();
    return true;
  }

  // --- Inventory Movements ---
  public getInventoryMovements(tenantId?: string): InventoryMovement[] {
    if (!tenantId) return [...this.movements];
    return this.movements.filter((m) => m.tenant_id === tenantId);
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
        const lineCost = product.cost_price * item.quantity;

        subtotal += lineSubtotal;
        totalDiscount += discountAmount;
        totalCost += lineCost;

        // Deduct inventory stock
        product.stock_quantity = Math.max(0, product.stock_quantity - item.quantity);

        this.movements.unshift({
          id: `mov-${Date.now()}-${idx}`,
          tenant_id: saleInput.tenant_id,
          branch_id: saleInput.branch_id,
          product_id: product.id,
          product_name: product.name,
          type: 'sale',
          quantity: item.quantity,
          reason: `POS Checkout receipt`,
          created_at: new Date().toISOString(),
        });

        if (this.supabaseClient) {
          this.supabaseClient
            .from('products')
            .update({ stock_quantity: product.stock_quantity })
            .eq('id', product.id)
            .then();
        }

        const saleItem: SaleItem = {
          id: `item-${Date.now()}-${idx}`,
          sale_id: saleId,
          product_id: product.id,
          product_name: product.name,
          barcode: product.barcode,
          unit_price: product.selling_price,
          cost_price: product.cost_price,
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
      this.supabaseClient.from('sales').insert([newSale]).then(({ error }) => {
        if (error) console.warn('Supabase sale sync note:', error.message);
      });
    }

    this.notify();
    return newSale;
  }

  public refundSale(saleId: string, reason?: string): boolean {
    const sale = this.sales.find((s) => s.id === saleId);
    if (!sale || sale.status === 'refunded') return false;

    sale.status = 'refunded';

    // Restock all items
    sale.items.forEach((item) => {
      const prod = this.products.find((p) => p.id === item.product_id);
      if (prod) {
        prod.stock_quantity += item.quantity;
        this.movements.unshift({
          id: `mov-${Date.now()}-${item.id}`,
          tenant_id: sale.tenant_id,
          branch_id: sale.branch_id,
          product_id: prod.id,
          product_name: prod.name,
          type: 'refund',
          quantity: item.quantity,
          reason: reason || 'Sale refund at till',
          created_at: new Date().toISOString(),
        });
      }
    });

    if (this.supabaseClient) {
      this.supabaseClient.from('sales').update({ status: 'refunded' }).eq('id', saleId).then();
    }

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

    this.branches.push({
      id: `branch-${Date.now()}`,
      tenant_id: newTenant.id,
      name: `${newTenant.name} Main Branch`,
      code: 'MAIN',
      address: newTenant.address,
      phone: newTenant.phone,
      is_main: true,
      is_active: true,
    });

    if (this.supabaseClient) {
      this.supabaseClient.from('tenants').insert([newTenant]).then();
    }

    this.notify();
    return newTenant;
  }

  public toggleTenantStatus(tenantId: string): boolean {
    const t = this.tenants.find((item) => item.id === tenantId);
    if (!t) return false;
    t.is_active = !t.is_active;
    if (this.supabaseClient) {
      this.supabaseClient.from('tenants').update({ is_active: t.is_active }).eq('id', tenantId).then();
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
      this.supabaseClient.from('tenants').update({ subscription_status: status }).eq('id', tenantId).then();
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
      this.supabaseClient.from('customers').insert([newCust]).then();
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
      this.supabaseClient.from('expenses').insert([newExp]).then();
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
      this.supabaseClient.from('users').insert([newUser]).then();
    }
    this.notify();
    return newUser;
  }

  public toggleUserStatus(userId: string): boolean {
    const u = this.users.find((user) => user.id === userId);
    if (!u) return false;
    u.is_active = !u.is_active;
    if (this.supabaseClient) {
      this.supabaseClient.from('users').update({ is_active: u.is_active }).eq('id', userId).then();
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

    if (password && user.password && user.password !== password) {
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
      this.supabaseClient.from('users').insert([newUser]).then();
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
    this.notify();
  }
}

export const db = new DatabaseService();
