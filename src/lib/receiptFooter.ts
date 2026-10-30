/**
 * The note printed at the foot of every receipt, resolved against the shop.
 *
 * The owner writes this in **Supermarket Store Settings → Receipt Footer
 * Note**. It lives on the tenant (`tenants.receipt_footer`) so the same text
 * is produced by every device, and because the tenant streams over realtime an
 * edit reaches an open till the moment it is saved.
 *
 * Three states, deliberately distinguishable:
 *
 *   `undefined` — never edited: the shop gets the built-in default note.
 *   `''`        — cleared on purpose: no footer line at all.
 *   `'…'`       — exactly what the owner typed.
 */
import type { Tenant } from '../types/index.ts';

/** What a shop that never edited its footer note prints. */
export const DEFAULT_RECEIPT_FOOTER =
  'Thank you for shopping with us! Goods sold are returnable within 48h with receipt.';

/** The footer note for `tenant`, falling back to {@link DEFAULT_RECEIPT_FOOTER}. */
export function receiptFooterText(tenant: Pick<Tenant, 'receipt_footer'>): string {
  return tenant.receipt_footer ?? DEFAULT_RECEIPT_FOOTER;
}
