export type UserRole = 'super_admin' | 'shop_owner' | 'cashier';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  phone: string;
  email: string;
  address: string;
  tax_number?: string;
  currency: string;
  is_active: boolean;
  subscription_status: 'active' | 'trial' | 'past_due' | 'suspended';
  created_at: string;
}

export interface Branch {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  address: string;
  phone?: string;
  is_main: boolean;
  is_active: boolean;
}

export interface ProductCategory {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  color?: string;
  /** Optional parent category — enables one level of subcategories per shop. */
  parent_id?: string | null;
  /** Deactivated categories keep history but cannot receive new products. */
  is_active: boolean;
  deactivated_at?: string;
  deactivated_by?: string;
  created_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  category_id?: string;
  category_name?: string;
  name: string;
  sku: string;
  barcode: string;
  cost_price: number;
  /** Weighted-average purchase cost maintained by stock-in receipts. */
  avg_cost?: number;
  selling_price: number;
  stock_quantity: number;
  min_stock_threshold: number;
  image_url: string;
  unit: string;
  is_active: boolean;
  created_at: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  discount_percent: number;
}

export type PaymentMethod = 'cash' | 'mobile_money' | 'card' | 'split' | 'bank_transfer' | 'other';

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  barcode: string;
  unit_price: number;
  cost_price: number;
  quantity: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
}

export interface Sale {
  id: string;
  tenant_id: string;
  branch_id: string;
  register_id?: string;
  cashier_id: string;
  cashier_name: string;
  shop_name: string;
  customer_name?: string;
  invoice_number: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  cost_amount: number;
  payment_method: PaymentMethod;
  payment_details?: {
    cash_tendered?: number;
    change_due?: number;
    momo_network?: string;
    momo_number?: string;
    momo_reference?: string;
    card_reference?: string;
  };
  status: 'completed' | 'refunded' | 'voided';
  created_at: string;
  items: SaleItem[];
}

export interface CashRegisterShift {
  id: string;
  tenant_id: string;
  branch_id: string;
  register_id: string;
  cashier_id: string;
  cashier_name: string;
  opening_cash: number;
  closing_cash?: number;
  expected_cash: number;
  cash_sales: number;
  start_time: string;
  end_time?: string;
  status: 'open' | 'closed';
  notes?: string;
}

/**
 * Canonical stock movement types.
 * - in-flow:  opening_stock, restock (supplier receipt), customer_return, transfer_in, refund
 * - out-flow: sale, supplier_return, damage, expired, transfer_out
 * - signed:   adjustment (quantity carries its own +/- sign), reversal (mirrors target)
 */
export type InventoryMovementType =
  | 'opening_stock'
  | 'sale'
  | 'restock'
  | 'customer_return'
  | 'supplier_return'
  | 'damage'
  | 'expired'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'refund'
  | 'reversal';

export type MovementReferenceType =
  | 'sale'
  | 'receipt'
  | 'refund'
  | 'adjustment'
  | 'transfer'
  | 'count'
  | 'manual';

export interface InventoryMovement {
  id: string;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  product_name?: string;
  type: InventoryMovementType;
  /** Magnitude for in/out types; signed value for adjustment/reversal. */
  quantity: number;
  /** Unit cost at the time of movement (stock receipts / COGS snapshot). */
  unit_cost?: number;
  /** Product stock balance immediately after this movement. */
  balance_after?: number;
  reference_id?: string;
  reference_type?: MovementReferenceType;
  /** Links a reversal to the movement it reverses. */
  reversal_of?: string;
  reason?: string;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
}

export interface Expense {
  id: string;
  tenant_id: string;
  branch_id: string;
  category: string;
  amount: number;
  description: string;
  expense_date: string;
  created_at: string;
}

export interface UserAccount {
  id: string;
  tenant_id?: string;
  shop_name?: string;
  full_name: string;
  email: string;
  role: UserRole;
  phone: string;
  password?: string;
  pin?: string;
  is_active: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  email?: string;
  loyalty_points: number;
  total_spent: number;
  created_at: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  price_yearly: number;
  max_branches: number;
  max_users: number;
  max_products: number;
  features: string[];
  is_active: boolean;
}

export interface ParkedCart {
  id: string;
  tenant_id: string;
  customer_name?: string;
  notes?: string;
  items: CartItem[];
  created_at: string;
  total_amount: number;
}

export interface CashMovement {
  id: string;
  tenant_id: string;
  shift_id: string;
  type: 'cash_in' | 'cash_out';
  amount: number;
  reason: string;
  created_at: string;
}

