/**
 * Financial calculation and currency formatting utilities
 * Strictly using integer cents/pesewas or high-precision decimal math
 * to avoid floating-point errors in currency calculations (GH₵ / GHS).
 */

export interface CartItemCalculation {
  price: number; // In GHS (e.g. 5.50)
  quantity: number;
  discountPercent?: number; // 0-100
  taxPercent?: number; // 0-100
}

export interface CartTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/**
 * Format number to Ghanaian Cedis display
 * Example: 48750 -> "GH₵ 48,750.00"
 */
export function formatGHS(amount: number | null | undefined): string {
  const val = Number(amount) || 0;
  return `GH₵ ${val.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Round to standard 2 decimal places for currency
 */
export function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate totals for a list of cart items
 */
export function calculateCartTotals(
  items: CartItemCalculation[],
  globalDiscountPercent: number = 0,
  taxRatePercent: number = 0
): CartTotals {
  let subtotal = 0;
  let itemDiscounts = 0;

  for (const item of items) {
    const lineGross = item.price * item.quantity;
    subtotal += lineGross;
    if (item.discountPercent && item.discountPercent > 0) {
      itemDiscounts += lineGross * (item.discountPercent / 100);
    }
  }

  const globalDiscount = (subtotal - itemDiscounts) * (globalDiscountPercent / 100);
  const discountTotal = roundToTwo(itemDiscounts + globalDiscount);
  const taxableAmount = Math.max(0, subtotal - discountTotal);
  const taxTotal = roundToTwo(taxableAmount * (taxRatePercent / 100));
  const total = roundToTwo(taxableAmount + taxTotal);

  return {
    subtotal: roundToTwo(subtotal),
    discountTotal,
    taxTotal,
    total,
  };
}

/**
 * Calculate change due from cash tendered
 */
export function calculateCashChange(totalDue: number, amountTendered: number): {
  changeDue: number;
  isSufficient: boolean;
} {
  const diff = roundToTwo(amountTendered - totalDue);
  return {
    changeDue: Math.max(0, diff),
    isSufficient: diff >= 0,
  };
}

/**
 * Validate split payments against total due
 */
export function validateSplitPayments(
  splits: { method: string; amount: number }[],
  totalDue: number
): { isValid: boolean; remaining: number; allocated: number } {
  const allocated = roundToTwo(
    splits.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
  );
  const remaining = roundToTwo(totalDue - allocated);
  return {
    isValid: Math.abs(remaining) < 0.01,
    remaining: Math.max(0, remaining),
    allocated,
  };
}

/**
 * Calculate Gross Profit and Gross Margin
 */
export function calculateGrossProfit(
  revenue: number,
  costOfGoodsSold: number
): { grossProfit: number; grossMarginPercent: number } {
  const grossProfit = roundToTwo(revenue - costOfGoodsSold);
  const grossMarginPercent = revenue > 0 ? roundToTwo((grossProfit / revenue) * 100) : 0;
  return { grossProfit, grossMarginPercent };
}
