/**
 * Customer-display projection helpers.
 *
 * The customer screen (in-page modal *and* the Electron second-monitor window)
 * must never see internal product data — no cost, stock, tenant ids. This is
 * the single place where a cart is narrowed to the exact fields the customer is
 * allowed to see, so both display paths stay identical by construction.
 */
import type {CartItem, CustomerDisplayItem, CustomerDisplayState} from '../types';

/** Narrow one cart line to the customer-facing projection. */
export function cartToCustomerItems(cart: CartItem[]): CustomerDisplayItem[] {
  return cart.map((item) => ({
    id: item.product.id,
    name: item.product.name,
    imageUrl: item.product.image_url,
    unitPrice: item.product.selling_price,
    quantity: item.quantity,
  }));
}

/**
 * Build the full customer-display state for the current sale.
 *
 * `totalAmount` comes from `calculateCartTotals` in the cashier (it already
 * includes line discounts), so the display shows the same amount due the
 * cashier's checkout panel shows.
 */
export function buildCustomerDisplayState(
  tenantName: string,
  cart: CartItem[],
  totalAmount: number,
): CustomerDisplayState {
  return {
    tenantName,
    items: cartToCustomerItems(cart),
    totalAmount,
  };
}

/**
 * Is a sale currently in progress?
 *
 * Used by the Electron main process as the single source of truth for the
 * frameless window's close guard: while the till holds unsold lines, closing
 * the window must ask first instead of silently discarding the cart. The
 * cashier pushes its projected cart on every change (scan, qty edit, remove,
 * clear, completed payment), so `items` is empty exactly when nothing is at
 * risk — a completed sale clears the cart, and the logged-out state pushes
 * an empty payload too.
 */
export function hasActiveSale(state: CustomerDisplayState | null): boolean {
  return state !== null && state.items.length > 0;
}
