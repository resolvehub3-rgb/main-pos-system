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

export interface CommerceConfig {
  /** Commerce Supabase project URL, no trailing slash. */
  supabaseUrl: string;
  /** Service-role key. Server-only; bypasses RLS; never sent to the browser. */
  supabaseServiceRoleKey: string;
  /** HS256 secret used to verify Supabase Auth access tokens. */
  authJwtSecret: string;
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
  /**
   * Master gate for starting payments. Must be explicitly "true" and stays
   * false until the owner approves the commercial decisions in
   * landing/docs/01-commercial-decisions.md.
   */
  checkoutEnabled: boolean;
  /** Gate for publishing prices through /api/plans. Off until approval. */
  publishPrices: boolean;
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

/**
 * Load and validate all commerce configuration.
 * Returns ok:false with the *names* of missing/invalid variables (never
 * values) so operators can fix setup without leaking anything.
 */
export function getCommerceConfig(): ConfigResult {
  const missing: string[] = [];
  const invalid: string[] = [];

  const need = (name: string): string | undefined => {
    const value = readEnv(name);
    if (value === undefined) missing.push(name);
    return value;
  };

  const supabaseUrlRaw = need('SUPABASE_COMMERCE_URL');
  const serviceRoleKey = need('SUPABASE_COMMERCE_SERVICE_ROLE_KEY');
  const authJwtSecret = need('SUPABASE_AUTH_JWT_SECRET');
  const paystackSecretKey = need('PAYSTACK_SECRET_KEY');
  const appBaseUrlRaw = need('APP_BASE_URL');

  let supabaseUrl: string | null = null;
  if (supabaseUrlRaw !== undefined) {
    supabaseUrl = normalizeBaseUrl(supabaseUrlRaw);
    if (supabaseUrl === null) invalid.push('SUPABASE_COMMERCE_URL');
  }

  if (serviceRoleKey !== undefined) {
    if (serviceRoleKey.startsWith('sb_publishable_')) {
      // Common mistake: pasting the publishable (client) key into the
      // service-role slot. That key cannot bypass RLS and must not be used.
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
      // Catches pasting the publishable key (pk_...) into the secret slot.
      invalid.push('PAYSTACK_SECRET_KEY');
    } else if (!paystackSecretKey.startsWith('sk_test_')) {
      if (readFlag('ALLOW_LIVE_PAYMENTS')) {
        paystackMode = 'live';
      } else {
        // Refuse live keys unless live payments are explicitly allowed.
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
      authJwtSecret: authJwtSecret as string,
      paystackSecretKey: paystackSecretKey as string,
      paystackWebhookSecret: readEnv('PAYSTACK_WEBHOOK_SECRET') ?? (paystackSecretKey as string),
      paystackPublicKey: readEnv('PAYSTACK_PUBLIC_KEY'),
      paystackMode,
      appBaseUrl: appBaseUrl as string,
      installerBucket,
      downloadLinkTtlSeconds,
      checkoutEnabled: readFlag('CHECKOUT_ENABLED'),
      publishPrices: readFlag('PUBLISH_PRICES'),
      auditHashSalt: readEnv('AUDIT_HASH_SALT'),
    },
  };
}
