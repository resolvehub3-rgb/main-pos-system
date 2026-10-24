/**
 * Stock Book, stock movement classification, weighted-average cost, and
 * stock-days estimation.
 *
 * Everything in this module is PURE — it derives reports only from actual
 * inventory movement records and product data. No quantities are ever
 * fabricated: when a product has no recorded movement history the stock book
 * clearly reports that reliable tracking only begins at the first movement.
 *
 * Business days use the device's local calendar day (the till's business day),
 * keyed as 'YYYY-MM-DD'.
 */
import type {
  InventoryMovement,
  InventoryMovementType,
  Product,
  ProductCategory,
} from '../types/index.ts';

// ---------------------------------------------------------------------------
// Movement classification
// ---------------------------------------------------------------------------

/** Stock-in movement types (quantity increases inventory). */
export const MOVEMENT_IN_TYPES: InventoryMovementType[] = [
  'opening_stock',
  'restock',
  'customer_return',
  'transfer_in',
  'refund',
];

/** Stock-out movement types (quantity decreases inventory). */
export const MOVEMENT_OUT_TYPES: InventoryMovementType[] = [
  'sale',
  'supplier_return',
  'damage',
  'expired',
  'transfer_out',
];

/** Movement types whose `quantity` carries its own +/- sign. */
export const MOVEMENT_SIGNED_TYPES: InventoryMovementType[] = ['adjustment', 'reversal'];

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  opening_stock: 'Opening Stock',
  sale: 'Sale',
  restock: 'Supplier Receipt',
  customer_return: 'Customer Return',
  supplier_return: 'Supplier Return',
  damage: 'Damaged',
  expired: 'Expired',
  adjustment: 'Adjustment',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  refund: 'Refund / Return',
  reversal: 'Reversal',
};

/** Signed quantity change applied to stock by a movement. */
export function movementDelta(m: Pick<InventoryMovement, 'type' | 'quantity'>): number {
  const qty = Number(m.quantity) || 0;
  if (MOVEMENT_IN_TYPES.includes(m.type)) return Math.abs(qty);
  if (MOVEMENT_OUT_TYPES.includes(m.type)) return -Math.abs(qty);
  // adjustment + reversal: quantity is already signed
  return qty;
}

// ---------------------------------------------------------------------------
// Business-day helpers (local calendar days)
// ---------------------------------------------------------------------------

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(key: string, days: number): string {
  const d = dayKeyToDate(key);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

export function todayKey(now: Date = new Date()): string {
  return dayKey(now);
}

/** All business-day keys from `from` to `to`, inclusive. */
export function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  // Guard against pathological ranges (max ~10 years)
  let guard = 0;
  while (cursor <= to && guard++ < 3660) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

// ---------------------------------------------------------------------------
// Weighted-average cost
// ---------------------------------------------------------------------------

/**
 * Weighted-average unit cost after receiving `receivedQty` units at
 * `unitCost` into an existing quantity of `currentQty` at `currentAvgCost`.
 * Outbound movements never change the weighted-average cost.
 */
export function weightedAverageOnReceipt(
  currentQty: number,
  currentAvgCost: number,
  receivedQty: number,
  unitCost: number
): number {
  const inQty = Math.abs(receivedQty);
  const existingValue = Math.max(0, currentQty) * currentAvgCost;
  const incomingValue = inQty * unitCost;
  const totalQty = Math.max(0, currentQty) + inQty;
  if (totalQty <= 0) return currentAvgCost;
  return (existingValue + incomingValue) / totalQty;
}

/** Current effective unit cost of a product (weighted-average, fallback cost). */
export function effectiveUnitCost(product: Pick<Product, 'avg_cost' | 'cost_price'>): number {
  const avg = Number(product.avg_cost);
  if (Number.isFinite(avg) && avg > 0) return avg;
  return Number(product.cost_price) || 0;
}

// ---------------------------------------------------------------------------
// Stock Book
// ---------------------------------------------------------------------------

export interface StockBookDayRow {
  date: string;
  opening: number;
  /** opening_stock + supplier receipts + transfers in */
  received: number;
  /** opening + received */
  total: number;
  sold: number;
  /** customer returns / refunds back into sellable stock */
  returned: number;
  /** damage + expiry + supplier returns (net units removed) */
  otherOut: number;
  /** signed net of manual adjustments / count corrections / reversals */
  adjustments: number;
  closing: number;
  /** closing stock valued at weighted-average cost */
  valueAtCost: number;
}

export interface StockBookProductEntry {
  product: Product;
  category?: ProductCategory;
  /** First date with recorded movement history — before this, history is unverifiable */
  reliableFrom: string | null;
  /** Set when the product has no movement history at all */
  historyNote: string | null;
  days: StockBookDayRow[];
  unitCost: number;
  /** Closing (current) stock quantity */
  currentStock: number;
  currentValueAtCost: number;
  /** Whether the ledger closing balance matches the product's live stock */
  reconciles: boolean | null;
}

export interface StockBookData {
  from: string;
  to: string;
  entries: StockBookProductEntry[];
  /** Overall report totals (closing value at cost) */
  totalValueAtCost: number;
}

interface BuildStockBookParams {
  products: Product[];
  movements: InventoryMovement[];
  categories: ProductCategory[];
  from: string;
  to: string;
  categoryId?: string;
  productId?: string;
}

/**
 * Build the combined stock book (one row per product per business day),
 * grouped by the shop's categories, straight from the movement ledger.
 */
export function buildStockBook(params: BuildStockBookParams): StockBookData {
  const { movements, from, to } = params;
  const wantedDays = dayRange(from, to);
  const entries: StockBookProductEntry[] = [];
  let totalValueAtCost = 0;

  const products = params.products
    .filter((p) => (params.productId ? p.id === params.productId : true))
    .filter((p) => {
      if (!params.categoryId) return true;
      return p.category_id === params.categoryId;
    });

  for (const product of products) {
    const productMovements = movements
      .filter((m) => m.product_id === product.id)
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const category = product.category_id
      ? params.categories.find((c) => c.id === product.category_id)
      : undefined;

    const unitCost = effectiveUnitCost(product);

    if (productMovements.length === 0) {
      // No ledger history: DO NOT fabricate movements. Show current position only.
      entries.push({
        product,
        category,
        reliableFrom: null,
        historyNote:
          'No stock movement history recorded — reliable daily tracking begins with the first recorded movement.',
        days: [],
        unitCost,
        currentStock: product.stock_quantity,
        currentValueAtCost: product.stock_quantity * unitCost,
        reconciles: null,
      });
      totalValueAtCost += product.stock_quantity * unitCost;
      continue;
    }

    const firstTrackedAt = new Date(productMovements[0].created_at);
    const firstTrackedDay = dayKey(firstTrackedAt);

    // Sum signed deltas per business day
    const deltasByDay = new Map<string, number>();
    const bucketsByDay = new Map<
      string,
      { received: number; sold: number; returned: number; otherOut: number; adjustments: number }
    >();
    let balanceBeforeWindow = 0;

    for (const m of productMovements) {
      const mDay = dayKey(new Date(m.created_at));
      const delta = movementDelta(m);
      if (mDay < from) balanceBeforeWindow += delta;
      deltasByDay.set(mDay, (deltasByDay.get(mDay) || 0) + delta);

      let bucket = bucketsByDay.get(mDay);
      if (!bucket) {
        bucket = { received: 0, sold: 0, returned: 0, otherOut: 0, adjustments: 0 };
        bucketsByDay.set(mDay, bucket);
      }
      const qty = Math.abs(Number(m.quantity) || 0);
      switch (m.type) {
        case 'opening_stock':
        case 'restock':
        case 'transfer_in':
          bucket.received += qty;
          break;
        case 'sale':
          bucket.sold += qty;
          break;
        case 'customer_return':
        case 'refund':
          bucket.returned += qty;
          break;
        case 'damage':
        case 'expired':
        case 'supplier_return':
          bucket.otherOut += qty;
          break;
        default:
          // adjustment / reversal are signed
          bucket.adjustments += Number(m.quantity) || 0;
          break;
      }
    }

    // Daily rows from tracking start (never before verifiable history)
    const startDay = wantedDays.length ? (wantedDays[0] > firstTrackedDay ? wantedDays[0] : firstTrackedDay) : from;
    const days = dayRange(startDay, to);
    const rows: StockBookDayRow[] = [];
    let opening = balanceBeforeWindow;

    for (const day of days) {
      const bucket = bucketsByDay.get(day) || {
        received: 0,
        sold: 0,
        returned: 0,
        otherOut: 0,
        adjustments: 0,
      };
      const total = opening + bucket.received;
      const closing = opening + (deltasByDay.get(day) || 0);
      rows.push({
        date: day,
        opening,
        received: bucket.received,
        total,
        sold: bucket.sold,
        returned: bucket.returned,
        otherOut: bucket.otherOut,
        adjustments: bucket.adjustments,
        closing,
        valueAtCost: closing * unitCost,
      });
      opening = closing;
    }

    // Ledger integrity check: sum of ALL signed movement deltas must equal
    // the product's live stock (regardless of the selected window).
    const ledgerBalance = productMovements.reduce((sum, m) => sum + movementDelta(m), 0);
    const reconciles = ledgerBalance === product.stock_quantity ? true : false;

    entries.push({
      product,
      category,
      reliableFrom: firstTrackedDay,
      historyNote:
        firstTrackedDay > from
          ? `Reliable daily tracking begins ${firstTrackedDay}; earlier balances are not reconstructable from the ledger.`
          : null,
      days: rows,
      unitCost,
      currentStock: product.stock_quantity,
      currentValueAtCost: product.stock_quantity * unitCost,
      reconciles,
    });
    totalValueAtCost += product.stock_quantity * unitCost;
  }

  // Group by category name for the combined report layout
  entries.sort((a, b) => {
    const ca = (a.category?.name || 'Uncategorised').localeCompare(b.category?.name || 'Uncategorised');
    if (ca !== 0) return ca;
    return a.product.name.localeCompare(b.product.name);
  });

  return { from, to, entries, totalValueAtCost: round2(totalValueAtCost) };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Estimated Days of Stock Remaining (30-day average sales method)
// ---------------------------------------------------------------------------

export type StockDaysUnavailableReason = 'no_sales' | 'no_history';

export interface StockDaysEstimate {
  /** null when no meaningful estimate can be produced */
  days: number | null;
  /** Average net daily sales over the trailing 30 calendar days */
  avgDailySales: number | null;
  netSold30d: number | null;
  /** True when based on less than a full 30 days of tracking history */
  preliminary: boolean;
  available: boolean;
  reason?: StockDaysUnavailableReason;
  message?: string;
}

const STOCK_DAYS_WINDOW = 30;

/**
 * Estimated days of stock remaining = current stock ÷ (net units sold in the
 * last 30 calendar days ÷ 30). Cancelled/voided sales are excluded; refunds
 * and customer returns are netted off because that stock returned to
 * sellable inventory. Never fabricates an estimate without sales history.
 */
export function estimateStockDays(
  product: Pick<Product, 'stock_quantity' | 'created_at'>,
  movements: Pick<InventoryMovement, 'type' | 'quantity' | 'created_at'>[],
  now: Date = new Date()
): StockDaysEstimate {
  const productMovements = movements
    .filter((m) => new Date(m.created_at).getTime() <= now.getTime())
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (productMovements.length === 0) {
    return {
      days: null,
      avgDailySales: null,
      netSold30d: null,
      preliminary: false,
      available: false,
      reason: 'no_history',
      message: 'No stock movement history recorded yet.',
    };
  }

  const windowStart = now.getTime() - STOCK_DAYS_WINDOW * 24 * 60 * 60 * 1000;
  // Net units SOLD = sales − (refunds / customer returns restored to stock)
  let soldQty = 0;
  let restoredQty = 0;
  for (const m of productMovements) {
    const t = new Date(m.created_at).getTime();
    if (t < windowStart || t > now.getTime()) continue;
    const qty = Math.abs(Number(m.quantity) || 0);
    if (m.type === 'sale') soldQty += qty;
    else if (m.type === 'refund' || m.type === 'customer_return') restoredQty += qty;
  }
  const netSold = soldQty - restoredQty;

  // Preliminary when tracking history is shorter than the 30-day window
  const firstTracked = new Date(productMovements[0].created_at).getTime();
  const preliminary = now.getTime() - firstTracked < STOCK_DAYS_WINDOW * 24 * 60 * 60 * 1000;

  if (netSold <= 0) {
    return {
      days: null,
      avgDailySales: 0,
      netSold30d: netSold,
      preliminary,
      available: false,
      reason: 'no_sales',
      message: preliminary
        ? 'Preliminary — no eligible sales recorded yet in the tracking history.'
        : 'No sales recorded in the last 30 days.',
    };
  }

  const avgDailySales = netSold / STOCK_DAYS_WINDOW;
  const days = product.stock_quantity / avgDailySales;

  return {
    days: Math.round(days * 10) / 10,
    avgDailySales: Math.round(avgDailySales * 1000) / 1000,
    netSold30d: netSold,
    preliminary,
    available: true,
    message: preliminary ? 'Preliminary estimate — less than 30 days of sales history.' : undefined,
  };
}
