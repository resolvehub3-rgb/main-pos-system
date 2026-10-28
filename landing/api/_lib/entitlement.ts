/**
 * Download-access decision logic (pure, unit-tested).
 *
 * An entitled customer may receive a signed installer URL only when ALL of
 * the following hold for the `samtill-pos` product:
 *   - they have an entitlement row for this product,
 *   - its status is `active` (not expired/revoked),
 *   - now is within [valid_from, valid_to).
 *
 * The decision is computed server-side from database state; nothing the
 * client sends can influence it. Reasons are returned so the caller can
 * record an accurate audit row — they are safe to show to the customer too
 * (they only describe their own subscription state).
 *
 * NOTE: this governs delivery of the installer FILE. It does not enforce
 * the licence inside an installed copy of SamTill — that is a separate,
 * future POS integration requiring explicit approval
 * (docs/04-installer-delivery-and-licensing.md).
 */

/** The product entitlements are issued for. */
export const PRODUCT_CODE = 'samtill-pos';

export interface EntitlementRow {
  product_code: string;
  status: string;
  /** ISO timestamp */
  valid_from: string;
  /** ISO timestamp */
  valid_to: string;
}

export type DownloadDenyReason =
  | 'no_entitlement'
  | 'wrong_product'
  | 'inactive_status'
  | 'not_yet_active'
  | 'expired'
  /**
   * `verified_account` mode only: the signed-in customer's email address has
   * not been confirmed yet. Produced when the authoritative Auth lookup says
   * the address is unconfirmed.
   */
  | 'email_unverified';

export type DownloadDecisionReason = 'granted' | DownloadDenyReason;

export interface DownloadDecision {
  allowed: boolean;
  reason: DownloadDecisionReason;
  /** ISO timestamp of the access window end, when one exists. */
  validTo?: string;
}

export function evaluateDownloadAccess(
  entitlements: EntitlementRow[],
  options: {now: Date; productCode?: string},
): DownloadDecision {
  const productCode = options.productCode ?? PRODUCT_CODE;
  const nowMs = options.now.getTime();

  const forProduct = entitlements.filter((row) => row.product_code === productCode);
  if (forProduct.length === 0) {
    // Distinguish "never bought anything" from "bought a different product".
    return {allowed: false, reason: entitlements.length > 0 ? 'wrong_product' : 'no_entitlement'};
  }

  const active = forProduct.filter((row) => row.status === 'active');
  if (active.length === 0) {
    return {allowed: false, reason: 'inactive_status'};
  }

  // The widest remaining window wins (renewals stack onto the latest end).
  let best = active[0];
  for (const row of active) {
    if (Date.parse(row.valid_to) > Date.parse(best.valid_to)) best = row;
  }

  const fromMs = Date.parse(best.valid_from);
  const toMs = Date.parse(best.valid_to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) {
    // Corrupt row -> fail closed.
    return {allowed: false, reason: 'inactive_status'};
  }

  if (nowMs < fromMs) {
    return {allowed: false, reason: 'not_yet_active', validTo: best.valid_to};
  }
  if (nowMs >= toMs) {
    return {allowed: false, reason: 'expired', validTo: best.valid_to};
  }
  return {allowed: true, reason: 'granted', validTo: best.valid_to};
}

/**
 * Build the `verified_account`-mode decision from an authoritative email
 * confirmation lookup. Pure, so the policy is unit-tested:
 *   - `undefined` → the lookup failed; deny WITHOUT recording an entitlement-
 *     style reason (the caller surfaces a backend error instead).
 *   - `false`      → the address is not confirmed; deny `email_unverified`.
 *   - `true`       → confirmed; allow.
 *
 * This is download ACCESS ONLY. It is never a subscription, licence or
 * payment confirmation.
 */
export function decideVerifiedAccountDownload(emailConfirmed: boolean | undefined): DownloadDecision {
  if (emailConfirmed === true) {
    return {allowed: true, reason: 'granted'};
  }
  return {allowed: false, reason: 'email_unverified'};
}

/** Map a decision to the `download_events.result` vocabulary (see SQL). */
export function toDownloadEventResult(decision: DownloadDecision): string {
  switch (decision.reason) {
    case 'granted':
      return 'granted';
    case 'no_entitlement':
      return 'denied_no_entitlement';
    case 'wrong_product':
      return 'denied_wrong_product';
    case 'not_yet_active':
      return 'denied_not_yet_active';
    case 'expired':
      return 'denied_expired';
    case 'inactive_status':
      return 'denied_inactive';
    case 'email_unverified':
      return 'denied_unverified_email';
  }
}
