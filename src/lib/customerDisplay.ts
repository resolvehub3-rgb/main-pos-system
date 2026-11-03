/**
 * Customer-display projection helpers.
 *
 * The customer screen (in-page modal *and* the second-monitor popup window)
 * must never see internal product data — no cost, stock, tenant ids. This is
 * the single place where a cart is narrowed to the exact fields the customer is
 * allowed to see, so both display paths stay identical by construction.
 */
import type {
  CartItem,
  CustomerDisplayItem,
  CustomerDisplayPayment,
  CustomerDisplayState,
} from '../types';
import {roundToTwo, type CartTotals} from './money';

/** Narrow one cart line to the customer-facing projection. */
export function cartToCustomerItems(cart: CartItem[]): CustomerDisplayItem[] {
  return cart.map((item) => {
    const lineGross = item.product.selling_price * item.quantity;
    const discountPercent = item.discount_percent || 0;
    const lineTotal =
      discountPercent > 0 ? roundToTwo(lineGross * (1 - discountPercent / 100)) : roundToTwo(lineGross);
    return {
      id: item.product.id,
      name: item.product.name,
      imageUrl: item.product.image_url,
      unitPrice: item.product.selling_price,
      quantity: item.quantity,
      lineTotal,
      discountPercent,
    };
  });
}

/**
 * Build the full customer-display state for the current sale.
 *
 * `totals` is the cashier's own `calculateCartTotals` result (src/lib/money.ts),
 * so subtotal, discounts, tax and the amount due on the customer screen are
 * byte-for-byte the figures the checkout panel shows. `tenantLogo` is
 * optional: a shop that has never uploaded a photo omits it and the screen
 * keeps its branded icon. `payment` rides along only while the completed-sale
 * confirmation should be on screen.
 */
export function buildCustomerDisplayState(
  tenantName: string,
  cart: CartItem[],
  totals: CartTotals,
  tenantLogo?: string,
  payment?: CustomerDisplayPayment,
): CustomerDisplayState {
  return {
    tenantName,
    ...(tenantLogo ? {tenantLogo} : {}),
    items: cartToCustomerItems(cart),
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    totalAmount: totals.total,
    ...(payment ? {payment} : {}),
  };
}
