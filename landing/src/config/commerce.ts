/**
 * Commerce preview — CLIENT-SIDE DISPLAY SWITCHES ONLY.
 *
 * These flags control what the marketing site *shows*. They cannot turn on
 * real payments or downloads: the serverless API independently refuses to
 * work until the commerce backend is provisioned (503 commerce_not_configured)
 * and until the operator sets CHECKOUT_ENABLED=true / PUBLISH_PRICES=true
 * server-side (see landing/docs/03-environment-variables.md).
 *
 * RULE: keep every flag below `false` until the owner has approved the
 * commercial decisions in landing/docs/01-commercial-decisions.md AND the
 * backend exists. Flipping a flag early would display an availability claim
 * the system cannot honour.
 */

export const COMMERCE = {
  /** Render the "customer area" preview section at all. */
  sectionEnabled: true,

  /** Customer sign-in via the future commerce project. */
  accountEnabled: false,

  /** Online payment (Paystack, test mode during preparation). */
  paymentsEnabled: false,

  /** Installer download entitlements for subscribers. */
  downloadEnabled: false,
} as const;
