/**
 * Feature-gate evaluation for the customer account / download screens.
 *
 * Pure and env-free so it can be unit-tested; the React layer passes the
 * compiled `COMMERCE` flags and the *public* Vite configuration in.
 *
 * Two independent conditions must BOTH hold before a form is shown:
 *
 *   1. the owner-controlled display switch in src/config/commerce.ts
 *      (`accountEnabled` / `downloadEnabled`), and
 *   2. an actual configured backend — the public commerce Supabase URL and
 *      publishable (anon) key compiled into the bundle via
 *      `VITE_COMMERCE_SUPABASE_URL` / `VITE_COMMERCE_SUPABASE_ANON_KEY`.
 *
 * Failing either shows a plain "not available yet" notice instead of a form,
 * so the site never presents a registration box that cannot work and never
 * claims availability the deployment cannot honour. The serverless API keeps
 * its own independent fail-closed checks (see api/_lib/env.ts).
 *
 * NOTE: neither value is a secret. The Supabase publishable/anon key is
 * designed to be shipped to browsers and cannot bypass Row Level Security.
 */

export type AvailabilityReason = 'available' | 'disabled' | 'not_configured';

export interface Availability {
  available: boolean;
  reason: AvailabilityReason;
  /** Customer-facing explanation; safe to render as-is. */
  notice: string;
}

export interface CommerceFlags {
  accountEnabled: boolean;
  downloadEnabled: boolean;
  paymentsEnabled: boolean;
}

export interface PublicCommerceConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

const DISABLED_NOTICE =
  'Customer accounts are not open yet. SamTeck Digital will announce when registration opens — until then, setup is arranged directly with the business.';
const NOT_CONFIGURED_NOTICE =
  'The customer account service is not configured for this deployment yet. Accounts cannot be created or used here at the moment.';
const DOWNLOAD_DISABLED_NOTICE =
  'Installer downloads are not published yet. The download will appear here once the owner has approved the release.';
const DOWNLOAD_NEEDS_ACCOUNT_NOTICE =
  'Signing in with a SamTill account is required before the installer download becomes available.';

function accountConfigured(config: PublicCommerceConfig): boolean {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

export function accountAvailability(
  flags: Pick<CommerceFlags, 'accountEnabled'>,
  config: PublicCommerceConfig,
): Availability {
  if (!flags.accountEnabled) {
    return {available: false, reason: 'disabled', notice: DISABLED_NOTICE};
  }
  if (!accountConfigured(config)) {
    return {available: false, reason: 'not_configured', notice: NOT_CONFIGURED_NOTICE};
  }
  return {available: true, reason: 'available', notice: ''};
}

/**
 * The download screen issues requests against the API with a signed-in
 * session, so it is available only when the account switch is on AND the
 * download switch is on AND the backend is configured.
 */
export function downloadAvailability(
  flags: Pick<CommerceFlags, 'accountEnabled' | 'downloadEnabled'>,
  config: PublicCommerceConfig,
): Availability {
  const account = accountAvailability(flags, config);
  if (!flags.downloadEnabled) {
    return {available: false, reason: 'disabled', notice: DOWNLOAD_DISABLED_NOTICE};
  }
  if (!account.available) {
    // Account service off/unconfigured ⇒ a download session cannot exist.
    return {
      available: false,
      reason: account.reason,
      notice: account.reason === 'disabled' ? DOWNLOAD_NEEDS_ACCOUNT_NOTICE : account.notice,
    };
  }
  return {available: true, reason: 'available', notice: ''};
}

const CHECKOUT_DISABLED_NOTICE =
  'Online checkout is not open yet. Choose a package and send an enquiry — SamTeck Digital will confirm the price and arrange purchase with you directly.';
const CHECKOUT_NEEDS_ACCOUNT_NOTICE =
  'Buying online needs a SamTill account: create one first (or sign in), then come back to this package.';

/**
 * Checkout needs the payment switch AND the account switch (a payment is tied
 * to a signed-in session) AND a configured commerce backend. Independent of
 * the server's own `CHECKOUT_ENABLED` / `PUBLISH_PRICES` gates, which stay
 * authoritative — this only decides what the site offers to click.
 */
export function checkoutAvailability(
  flags: Pick<CommerceFlags, 'accountEnabled' | 'paymentsEnabled'>,
  config: PublicCommerceConfig,
): Availability {
  const account = accountAvailability(flags, config);
  if (!flags.paymentsEnabled) {
    return {available: false, reason: 'disabled', notice: CHECKOUT_DISABLED_NOTICE};
  }
  if (!account.available) {
    return {
      available: false,
      reason: account.reason,
      notice:
        account.reason === 'disabled' ? CHECKOUT_NEEDS_ACCOUNT_NOTICE : account.notice,
    };
  }
  return {available: true, reason: 'available', notice: ''};
}
