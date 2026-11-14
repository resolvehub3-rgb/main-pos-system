/**
 * Commerce switches — client-side visibility flags.
 *
 * The backend API (/api/checkout, /api/verify, /api/plans, /api/subscription)
 * enforces all payment and security checks server-side against Supabase and
 * Paystack.
 */

export const COMMERCE = {
  /** Render the customer account & checkout flows. */
  sectionEnabled: true,

  /** Customer sign-in and registration via the Supabase project. */
  accountEnabled: true,

  /** Online payment (Paystack hosted checkout for the 6-Month Subscription). */
  paymentsEnabled: true,
} as const;
