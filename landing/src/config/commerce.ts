/**
 * Commerce preview — CLIENT-SIDE DISPLAY SWITCHES ONLY.
 *
 * These flags control what the marketing site *shows*. They cannot turn on
 * real payments: the serverless API independently refuses to
 * work until the commerce backend is provisioned (503 commerce_not_configured)
 * and until the operator sets CHECKOUT_ENABLED=true / PUBLISH_PRICES=true
 * server-side (see landing/docs/03-environment-variables.md).
 *
 * RULE: keep `paymentsEnabled` false until the owner has approved the
 * commercial decisions in landing/docs/01-commercial-decisions.md AND the
 * backend exists. `accountEnabled` is on so registration can open — but the
 * account screens still stay hidden until a real commerce Supabase project is
 * configured (see src/lib/availability.ts), so a deployment with no backend
 * never shows a form it cannot honour. Every new account starts 'pending' and
 * needs a super-admin approval before its dashboard unlocks
 * (db/migrations/0002_account_approval.sql).
 */

export const COMMERCE = {
  /** Render the "customer area" preview section at all. */
  sectionEnabled: true,

  /**
   * Customer sign-in via the commerce project. Registration is open but
   * approval-gated: a new account is 'pending' until a super-admin approves it
   * (which emails the customer). Still requires a configured backend to show.
   */
  accountEnabled: true,

  /** Online payment (Paystack, test mode during preparation). */
  paymentsEnabled: false,
} as const;
