/**
 * Rows read back from the mirror, in the app's own types.
 *
 * The mirror is the *nullable* mirror of the app's data: `productRow` sends
 * `sku`, `unit` and `image_url` as NULL when they are blank, `customerRow`
 * does the same for `phone`, and `saleRow` never carries `sale_id` on an item
 * because nothing in the app writes one. Those are all fine going out — they
 * are nullable columns. Coming back they are not fine: the till calls
 * `product.sku.toLowerCase()` to scan a barcode, and a single product saved
 * without a SKU would blank the whole checkout screen with a TypeError.
 *
 * So anything read from Supabase goes through here first. Every field is
 * reconstructed explicitly rather than spread, which doubles as a record of
 * what the round trip actually preserves.
 */
import type { Customer, Product, ProductCategory, Sale, SaleItem } from '../types/index.ts';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const PAYMENT_METHODS = new Set([
  'cash',
  'mobile_money',
  'card',
  'split',
  'bank_transfer',
  'other',
]);

const STATUSES = new Set(['completed', 'refunded', 'voided']);

export function adoptProduct(raw: Record<string, unknown>): Product {
  return {
    id: text(raw.id),
    tenant_id: text(raw.tenant_id),
    category_id: optionalText(raw.category_id),
    category_name: optionalText(raw.category_name),
    name: text(raw.name),
    sku: text(raw.sku),
    barcode: text(raw.barcode),
    cost_price: number(raw.cost_price),
    avg_cost: typeof raw.avg_cost === 'number' ? raw.avg_cost : undefined,
    selling_price: number(raw.selling_price),
    stock_quantity: number(raw.stock_quantity),
    min_stock_threshold: number(raw.min_stock_threshold),
    image_url: text(raw.image_url),
    unit: text(raw.unit),
    // Absent means active: the mirror omits nothing, but a row written before
    // the column existed should not read as a hidden product.
    is_active: raw.is_active !== false,
    created_at: text(raw.created_at),
  };
}

export function adoptCategory(raw: Record<string, unknown>): ProductCategory {
  return {
    id: text(raw.id),
    tenant_id: text(raw.tenant_id),
    name: text(raw.name),
    description: optionalText(raw.description),
    color: optionalText(raw.color),
    parent_id: optionalText(raw.parent_id),
    is_active: raw.is_active !== false,
    deactivated_at: optionalText(raw.deactivated_at),
    deactivated_by: optionalText(raw.deactivated_by),
    created_at: text(raw.created_at),
  };
}

export function adoptCustomer(raw: Record<string, unknown>): Customer {
  return {
    id: text(raw.id),
    tenant_id: text(raw.tenant_id),
    name: text(raw.name),
    phone: text(raw.phone),
    email: optionalText(raw.email),
    loyalty_points: number(raw.loyalty_points),
    total_spent: number(raw.total_spent),
    created_at: text(raw.created_at),
  };
}

export function adoptSale(raw: Record<string, unknown>): Sale {
  const saleId = text(raw.id);
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const details =
    raw.payment_details && typeof raw.payment_details === 'object'
      ? (raw.payment_details as Sale['payment_details'])
      : undefined;

  return {
    id: saleId,
    tenant_id: text(raw.tenant_id),
    branch_id: text(raw.branch_id),
    register_id: optionalText(raw.register_id),
    cashier_id: text(raw.cashier_id),
    cashier_name: text(raw.cashier_name),
    shop_name: text(raw.shop_name),
    customer_name: optionalText(raw.customer_name),
    invoice_number: text(raw.invoice_number),
    subtotal: number(raw.subtotal),
    discount_amount: number(raw.discount_amount),
    tax_amount: number(raw.tax_amount),
    total_amount: number(raw.total_amount),
    cost_amount: number(raw.cost_amount),
    payment_method: PAYMENT_METHODS.has(String(raw.payment_method))
      ? (raw.payment_method as Sale['payment_method'])
      : 'other',
    payment_details: details,
    status: STATUSES.has(String(raw.status)) ? (raw.status as Sale['status']) : 'completed',
    created_at: text(raw.created_at),
    items: rawItems.map((item) => adoptSaleItem(item, saleId)),
  };
}

/**
 * `sale_id` is the one field the mirror never carries: `saleRow` omits it and
 * no query joins on it, but the type requires it and a receipt reprint reads
 * the whole item, so it is restored from the parent.
 */
function adoptSaleItem(value: unknown, saleId: string): SaleItem {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    id: text(raw.id),
    sale_id: saleId,
    product_id: text(raw.product_id),
    product_name: text(raw.product_name),
    barcode: text(raw.barcode),
    unit_price: number(raw.unit_price),
    cost_price: number(raw.cost_price),
    quantity: number(raw.quantity),
    discount_amount: number(raw.discount_amount),
    tax_amount: number(raw.tax_amount),
    total_amount: number(raw.total_amount),
  };
}
