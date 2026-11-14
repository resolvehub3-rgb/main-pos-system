/**
 * Commerce preview — CLIENT-SIDE DISPLAY SWITCHES ONLY.
 *
 * These flags control what the marketing site exposes in the browser. Real
 * charges are still independently guarded server-side by Paystack credentials,
 * the active `public.plans` row (`samtill-pos-6m`), `PUBLISH_PRICES=true`, and
 * `CHECKOUT_ENABLED=true`.
 */

export const COMMERCE = {
  /** Render the customer account and subscription area. */
  sectionEnabled: true,

  /**
   * Customer sign-in via the commerce Supabase project.
   * Requires configured VITE_COMMERCE_SUPABASE_* values to activate screens.
   */
  accountEnabled: true,

  /** Online checkout via Paystack for the 6-Month Subscription (GH₵500.00). */
  paymentsEnabled: true,
} as const;
