/**
 * Role-based access rules for inventory management features.
 *
 * These checks are enforced inside the DatabaseService methods themselves
 * (not just by hiding UI), and mirrored by Row Level Security policies in
 * `supabase/migrations/20261024000001_stock_book_and_categories.sql` when the
 * app is connected to a Supabase backend.
 *
 * Rules:
 * - Shop owner / shop admin: full management of THEIR OWN shop only.
 * - Cashier: cannot manage categories, cannot open stock book, cannot read
 *   purchase costs or valuations through the restricted APIs.
 * - Super Admin: platform operator — allowed for support purposes, but the UI
 *   does not surface per-shop category management to them.
 */
import type { UserAccount } from '../types/index.ts';

function isActiveOwner(user: UserAccount | null, tenantId: string): boolean {
  if (!user || !user.is_active) return false;
  if (user.role !== 'shop_owner') return false;
  // Owner must belong to the exact tenant they are acting on.
  return Boolean(tenantId) && user.tenant_id === tenantId;
}

/** Category CRUD (create, rename, edit, deactivate, reactivate). */
export function canManageCategories(user: UserAccount | null, tenantId: string): boolean {
  return isActiveOwner(user, tenantId);
}

/** Opening the Stock Book pages and filters. */
export function canViewStockBook(user: UserAccount | null, tenantId: string): boolean {
  return isActiveOwner(user, tenantId);
}

/** Generating / downloading stock book PDFs. */
export function canGenerateStockBookReports(user: UserAccount | null, tenantId: string): boolean {
  return isActiveOwner(user, tenantId);
}

/** Reading purchase cost / weighted-average cost / valuation data. */
export function canViewCostDetails(user: UserAccount | null, tenantId: string): boolean {
  return isActiveOwner(user, tenantId);
}

/** Recording manual stock movements (receipts, damage, expiry, counts). */
export function canAdjustStock(user: UserAccount | null, tenantId: string): boolean {
  return isActiveOwner(user, tenantId);
}

/**
 * Product catalogue management: registering products, capturing their real
 * barcodes, editing prices / barcode assignments.
 *
 * The Add / Edit product screens are only mounted for the shop owner, but the
 * check is also applied inside the modals themselves so a cashier session can
 * never register products or reassign barcodes even if it reached them.
 * Super Admin is allowed as the platform support path (mirrors the dead
 * `onAddShop` prop on the super-admin dashboard).
 */
export function canManageProducts(user: UserAccount | null, tenantId: string): boolean {
  if (!user || !user.is_active) return false;
  if (user.role === 'super_admin') return true;
  return isActiveOwner(user, tenantId);
}

/**
 * Editing the store profile every receipt is printed from (legal name,
 * receipt address, phone, footer note).
 *
 * This is shop-wide configuration rather than per-till state, so it is owner-
 * only exactly like category management — a cashier session must not be able
 * to rewrite the name on the shop's invoices.
 */
export function canManageStoreProfile(user: UserAccount | null, tenantId: string): boolean {
  return isActiveOwner(user, tenantId);
}
