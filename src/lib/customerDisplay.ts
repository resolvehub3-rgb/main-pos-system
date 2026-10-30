/**
 * Customer-display projection helpers.
 *
 * The customer screen (in-page modal *and* the second-monitor popup window)
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
 * cashier's checkout panel shows. `tenantLogo` is optional: a shop that has
 * never uploaded a photo omits it and the screen keeps its branded icon.
 */
export function buildCustomerDisplayState(
  tenantName: string,
  cart: CartItem[],
  totalAmount: number,
  tenantLogo?: string,
): CustomerDisplayState {
  return {
    tenantName,
    ...(tenantLogo ? { tenantLogo } : {}),
    items: cartToCustomerItems(cart),
    totalAmount,
  };
}

