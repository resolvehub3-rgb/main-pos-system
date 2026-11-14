/**
 * Server-side configuration for the SamTill commerce API.
 *
 * SAFETY RULES ENFORCED HERE
 * 1. Values are read from the runtime process environment ONLY. There is no
 *    code path that reads `VITE_*` variables: Vite inlines those into the
 *    public browser bundle, so a secret must never use that prefix.
 * 2. The Paystack secret key must be a TEST key (`sk_test_...`) unless the
 *    operator explicitly sets ALLOW_LIVE_PAYMENTS=true. This makes it
 *    impossible for these functions to charge live money by accident.
 * 3. Missing or invalid configuration makes endpoints fail closed with
 *    HTTP 503 (`commerce_not_configured`) — never an insecure default.
 * 4. This module never logs values; only names/reasons leave this module.
 *
 * Variable names are documented in landing/docs/03-environment-variables.md.
 */

export type EnvBag = Record<string, string | undefined>;

function runtimeEnv(): EnvBag {
  const scope = globalThis as {process?: {env?: EnvBag}};
  return scope.process?.env ?? {};
}

/** Read one environment variable (trimmed; empty string -> undefined). */
export function readEnv(name: string): string | undefined {
  const raw = runtimeEnv()[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Boolean flags: only the literal string "true" (case-insensitive) counts. */
export function readFlag(name: string): boolean {
  return (readEnv(name) ?? '').toLowerCase() === 'true';
}

/** Opt-out boolean flags: active unless explicitly set to "false". */
export function readEnabledByDefaultFlag(name: string): boolean {
  const raw = readEnv(name);
  if (raw === undefined) return true;
  return raw.toLowerCase() !== 'false';
}

/** First defined & non-empty env variable among candidate names. */
function readFirstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Who may receive an installer download link:
 * - `entitlement`      (default): only customers with an active paid
 *                       entitlement — the pre-existing behaviour, unchanged
 *                       until the operator opts in to the other mode;
 * - `verified_account`: any customer who can sign in to the commerce project
 *                       (which, with "Confirm email" enabled there, means the
 *                       address was verified). Used while payments are
 *                       postponed so the registration → verify → login →
 *                       download journey works. Grants the installer FILE
 *                       only — it is NOT a POS licence activation.
 */
export type DownloadAccessMode = 'entitlement' | 'verified_account';

export interface CommerceConfig {
  /** Supabase project URL, no trailing slash. */
  supabaseUrl: string;
  /** Service-role key. Server-only; bypasses RLS; never sent to the browser. */
  supabaseServiceRoleKey: string;
  /** Optional HS256 secret used for fast local verification when issued HS256 JWTs. */
  authJwtSecret?: string;
  /** Paystack secret key. Test mode unless ALLOW_LIVE_PAYMENTS=true. */
  paystackSecretKey: string;
  /**
   * HMAC secret for Paystack's `x-paystack-signature` header. Paystack signs
   * with the integration secret key, so this defaults to paystackSecretKey
   * and only needs to be set separately if you rotate a dedicated value.
   */
  paystackWebhookSecret: string;
  /** Public (publishable) Paystack key — optional, not used by these functions. */
  paystackPublicKey?: string;
  paystackMode: 'test' | 'live';
  /** Public base URL of the site (no trailing slash) for Paystack callbacks. */
  appBaseUrl: string;
  /** Private storage bucket holding the installer. */
  installerBucket: string;
  /** Lifetime of generated signed download URLs, seconds (60..3600). */
  downloadLinkTtlSeconds: number;
  /** Master gate for starting payments (enabled unless CHECKOUT_ENABLED=false). */
  checkoutEnabled: boolean;
  /** Gate for publishing prices through /api/plans (enabled unless PUBLISH_PRICES=false). */
  publishPrices: boolean;
  /**
   * Server-side access mode for POST /api/download. Defaults to
   * `entitlement` (fail-closed to paid customers only).
   */
  downloadAccessMode: DownloadAccessMode;
  /** Optional salt for hashing client IPs in audit/download records. */
  auditHashSalt?: string;
}

export type ConfigResult =
  | {ok: true; config: CommerceConfig}
  | {ok: false; missing: string[]; invalid: string[]};

const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const DEFAULT_DOWNLOAD_TTL = 300;

function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return null;
    }
    return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
  } catch {
    return null;
  }
}

function resolveAppBaseUrl(): string | undefined {
  const explicit = readEnv('APP_BASE_URL');
  if (explicit !== undefined) return explicit;
  const vercelProd = readEnv('VERCEL_PROJECT_PRODUCTION_URL');
  if (vercelProd !== undefined) {
    return vercelProd.startsWith('http') ? vercelProd : `https://${vercelProd}`;
  }
  const vercelUrl = readEnv('VERCEL_URL');
  if (vercelUrl !== undefined) {
    return vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
  }
  return undefined;
}

/**
 * Load and validate all commerce configuration.
 * Returns ok:false with the *names* of missing/invalid variables (never
 * values) so operators can fix setup without leaking anything.
 */
export function getCommerceConfig(): ConfigResult {
  const missing: string[] = [];
  const invalid: string[] = [];

  const supabaseUrlRaw = readFirstEnv(['SUPABASE_COMMERCE_URL', 'SUPABASE_URL']);
  if (supabaseUrlRaw === undefined) missing.push('SUPABASE_COMMERCE_URL');

  const serviceRoleKey = readFirstEnv([
    'SUPABASE_COMMERCE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
  if (serviceRoleKey === undefined) missing.push('SUPABASE_COMMERCE_SERVICE_ROLE_KEY');

  const authJwtSecret = readEnv('SUPABASE_AUTH_JWT_SECRET');

  const paystackSecretKey = readEnv('PAYSTACK_SECRET_KEY');
  if (paystackSecretKey === undefined) missing.push('PAYSTACK_SECRET_KEY');

  const appBaseUrlRaw = resolveAppBaseUrl();
  if (appBaseUrlRaw === undefined) missing.push('APP_BASE_URL');

  let supabaseUrl: string | null = null;
  if (supabaseUrlRaw !== undefined) {
    supabaseUrl = normalizeBaseUrl(supabaseUrlRaw);
    if (supabaseUrl === null) invalid.push('SUPABASE_COMMERCE_URL');
  }

  if (serviceRoleKey !== undefined) {
    if (serviceRoleKey.startsWith('sb_publishable_')) {
      invalid.push('SUPABASE_COMMERCE_SERVICE_ROLE_KEY(wrong_key_class)');
    } else if (!serviceRoleKey.startsWith('sb_secret_') && !serviceRoleKey.startsWith('ey')) {
      invalid.push('SUPABASE_COMMERCE_SERVICE_ROLE_KEY');
    }
  }

  if (authJwtSecret !== undefined && authJwtSecret.length < 16) {
    invalid.push('SUPABASE_AUTH_JWT_SECRET');
  }

  let paystackMode: 'test' | 'live' = 'test';
  if (paystackSecretKey !== undefined) {
    if (!paystackSecretKey.startsWith('sk_')) {
      invalid.push('PAYSTACK_SECRET_KEY');
    } else if (!paystackSecretKey.startsWith('sk_test_')) {
      if (readFlag('ALLOW_LIVE_PAYMENTS')) {
        paystackMode = 'live';
      } else {
        invalid.push('PAYSTACK_SECRET_KEY(not_test_mode)');
      }
    }
  }

  let appBaseUrl: string | null = null;
  if (appBaseUrlRaw !== undefined) {
    appBaseUrl = normalizeBaseUrl(appBaseUrlRaw);
    if (appBaseUrl === null) invalid.push('APP_BASE_URL');
  }

  const installerBucket = readEnv('INSTALLER_BUCKET') ?? 'installers';
  if (!BUCKET_RE.test(installerBucket)) {
    invalid.push('INSTALLER_BUCKET');
  }

  let downloadAccessMode: DownloadAccessMode = 'entitlement';
  const downloadModeRaw = readEnv('DOWNLOAD_ACCESS_MODE');
  if (downloadModeRaw !== undefined) {
    const normalized = downloadModeRaw.toLowerCase();
    if (normalized === 'entitlement' || normalized === 'verified_account') {
      downloadAccessMode = normalized;
    } else {
      invalid.push('DOWNLOAD_ACCESS_MODE');
    }
  }

  let downloadLinkTtlSeconds = DEFAULT_DOWNLOAD_TTL;
  const ttlRaw = readEnv('DOWNLOAD_LINK_TTL_SECONDS');
  if (ttlRaw !== undefined) {
    const parsed = Number.parseInt(ttlRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 60 || parsed > 3600) {
      invalid.push('DOWNLOAD_LINK_TTL_SECONDS');
    } else {
      downloadLinkTtlSeconds = parsed;
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    return {ok: false, missing, invalid};
  }

  return {
    ok: true,
    config: {
      supabaseUrl: supabaseUrl as string,
      supabaseServiceRoleKey: serviceRoleKey as string,
      ...(authJwtSecret !== undefined ? {authJwtSecret} : {}),
      paystackSecretKey: paystackSecretKey as string,
      paystackWebhookSecret: readEnv('PAYSTACK_WEBHOOK_SECRET') ?? (paystackSecretKey as string),
      paystackPublicKey: readEnv('PAYSTACK_PUBLIC_KEY'),
      paystackMode,
      appBaseUrl: appBaseUrl as string,
      installerBucket,
      downloadLinkTtlSeconds,
      checkoutEnabled: readEnabledByDefaultFlag('CHECKOUT_ENABLED'),
      publishPrices: readEnabledByDefaultFlag('PUBLISH_PRICES'),
      downloadAccessMode,
      auditHashSalt: readEnv('AUDIT_HASH_SALT'),
    },
  };
}
