/**
 * Active-cart recovery for the cashier till.
 *
 * The cart lives in React state (App.tsx is the single source of truth for the
 * checkout), which means a browser refresh or an app restart used to drop the
 * sale the cashier was in the middle of. This module keeps a small, validated
 * copy of the *active* cart so the latest valid state can be restored after a
 * refresh, a crash or a reconnection — and so the customer display (which
 * re-requests the state on load) always has something truthful to show.
 *
 * Rules:
 *  - only the bare line references are stored (product id, quantity, line
 *    discount) — never prices, never customer or business data;
 *  - on restore every line is re-checked against the live product mirror:
 *    unknown/inactive/other-shop products are dropped and quantities are
 *    clamped to what is actually in stock, so a restored cart can never
 *    produce an invalid sale;
 *  - entries expire (TTL) and are cleared on sign-out, so a cart from last
 *    week never resurrects itself.
 */
import type {CartItem, Product} from '../types';

const STORAGE_KEY = 'samtech_active_cart_v1';

/** How long a saved cart stays restorable (a till restart within a shift). */
export const CART_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface PersistedCartLine {
  productId: string;
  quantity: number;
  discountPercent: number;
}

export interface PersistedCart {
  tenantId: string;
  userId: string;
  savedAt: number;
  lines: PersistedCartLine[];
}

/**
 * Re-validate saved lines against the current product mirror.
 *
 * Pure (no storage) so it can be unit-tested: drops lines whose product is
 * gone, inactive or belongs to another shop, clamps quantity to the stock on
 * hand and normalises the discount to 0–100.
 */
export function reconcileCart(
  lines: PersistedCartLine[],
  products: Product[],
  tenantId: string,
): CartItem[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: CartItem[] = [];

  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) continue;
    if (product.tenant_id !== tenantId) continue;
    if (product.is_active === false) continue;

    const stock = Math.max(0, Math.floor(product.stock_quantity ?? 0));
    const rawQuantity = Number(line.quantity);
    // A malformed or empty saved line is dropped rather than resurrected as
    // a quantity the cashier never scanned.
    if (!Number.isFinite(rawQuantity) || rawQuantity < 1) continue;
    const quantity = Math.min(Math.floor(rawQuantity), stock);
    if (quantity < 1) continue; // out of stock → nothing sellable to restore

    const discountPercent = Math.min(100, Math.max(0, Math.floor(line.discountPercent || 0)));
    out.push({product, quantity, discount_percent: discountPercent});
  }

  return out;
}

/** Key one saved cart per till session (tenant + signed-in user). */
function storageKey(tenantId: string, userId: string): string {
  return `${STORAGE_KEY}:${tenantId}:${userId}`;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/** Restore this till's active cart, or `[]` when there is nothing valid. */
export function loadActiveCart(tenantId: string, userId: string, products: Product[]): CartItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(storageKey(tenantId, userId));
    if (!raw) return [];
    const saved = JSON.parse(raw) as Partial<PersistedCart>;
    if (!saved || !Array.isArray(saved.lines)) return [];
    if (typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt > CART_TTL_MS) {
      localStorage.removeItem(storageKey(tenantId, userId));
      return [];
    }
    return reconcileCart(saved.lines as PersistedCartLine[], products, tenantId);
  } catch {
    return [];
  }
}

/** Remember the active cart (called on every cart change). */
export function saveActiveCart(tenantId: string, userId: string, cart: CartItem[]): void {
  if (!canUseStorage()) return;
  try {
    const key = storageKey(tenantId, userId);
    if (cart.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    const saved: PersistedCart = {
      tenantId,
      userId,
      savedAt: Date.now(),
      lines: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        discountPercent: item.discount_percent,
      })),
    };
    localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // Quota / private mode: recovery is a convenience, never a hard failure.
  }
}

/** Drop the saved cart (sign-out, explicit clear). */
export function clearActiveCart(tenantId: string, userId: string): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(storageKey(tenantId, userId));
  } catch {
    // ignore
  }
}
