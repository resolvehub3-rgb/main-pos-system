/**
 * Server-side configuration for the SamTill commerce API.
 *
 * SAFETY RULES ENFORCED HERE
 * 1. Secret values are read from server process environment ONLY. Secrets
 *    never use the `VITE_` prefix and are never returned to browsers.
 * 2. The Paystack secret key must be a TEST key (`sk_test_...`) unless the
 *    operator explicitly sets ALLOW_LIVE_PAYMENTS=true.
 * 3. Missing or invalid configuration makes endpoints fail closed with HTTP 503.
 * 4. Supports both a unified Supabase project (`SUPABASE_URL` / `VITE_SUPABASE_URL`
 *    + `SUPABASE_SERVICE_ROLE_KEY` using `commerce_*` tables) and a separate
 *    commerce Supabase project (`SUPABASE_COMMERCE_URL` +
 *    `SUPABASE_COMMERCE_SERVICE_ROLE_KEY`).
 */

export type EnvBag = Record<string, string | undefined>;

function runtimeEnv(): EnvBag {
  const scope = globalThis as {process?: {env?: EnvBag}};
  return scope.process?.env ?? {};
}

export function readEnv(name: string): string | undefined {
  const raw = runtimeEnv()[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function readFlag(name: string, defaultValue = false): boolean {
  const raw = readEnv(name);
  if (raw === undefined) return defaultValue;
  return raw.toLowerCase() === 'true';
}

export type DownloadAccessMode = 'entitlement' | 'verified_account';

export interface CommerceConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** Optional HS256 secret; when omitted or asymmetric, /auth/v1/user is used. */
  authJwtSecret?: string;
  /** Table prefix: `'commerce_'` on unified POS DB, `''` on standalone commerce DB. */
  tablePrefix: string;
  paystackSecretKey: string;
  paystackWebhookSecret: string;
  paystackPublicKey?: string;
  paystackMode: 'test' | 'live';
  appBaseUrl: string;
  installerBucket: string;
  downloadLinkTtlSeconds: number;
  checkoutEnabled: boolean;
  publishPrices: boolean;
  downloadAccessMode: DownloadAccessMode;
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
    if (
      url.protocol !== 'https:' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1'
    ) {
      return null;
    }
    return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
  } catch {
    return null;
  }
}

function resolveSupabaseBase(): {
  missing: string[];
  invalid: string[];
  supabaseUrl?: string;
  serviceRoleKey?: string;
  authJwtSecret?: string;
  tablePrefix: string;
} {
  const missing: string[] = [];
  const invalid: string[] = [];

  const explicitCommerceUrl = readEnv('SUPABASE_COMMERCE_URL');
  const posUrl = readEnv('SUPABASE_URL') ?? readEnv('VITE_SUPABASE_URL');
  const supabaseUrlRaw = explicitCommerceUrl ?? posUrl;
  if (!supabaseUrlRaw) {
    missing.push('SUPABASE_URL');
  }

  const serviceRoleKey =
    readEnv('SUPABASE_COMMERCE_SERVICE_ROLE_KEY') ?? readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }

  const authJwtSecret = readEnv('SUPABASE_AUTH_JWT_SECRET');
  if (authJwtSecret !== undefined && authJwtSecret.length < 16) {
    invalid.push('SUPABASE_AUTH_JWT_SECRET');
  }

  let supabaseUrl: string | undefined;
  if (supabaseUrlRaw !== undefined) {
    const normalized = normalizeBaseUrl(supabaseUrlRaw);
    if (normalized === null) invalid.push('SUPABASE_URL');
    else supabaseUrl = normalized;
  }

  if (serviceRoleKey !== undefined) {
    if (serviceRoleKey.startsWith('sb_publishable_')) {
      invalid.push('SUPABASE_SERVICE_ROLE_KEY(wrong_key_class)');
    } else if (!serviceRoleKey.startsWith('sb_secret_') && !serviceRoleKey.startsWith('ey')) {
      invalid.push('SUPABASE_SERVICE_ROLE_KEY');
    }
  }

  const normalizedPosUrl = posUrl ? normalizeBaseUrl(posUrl) : null;
  const unifiedProject =
    !explicitCommerceUrl || (normalizedPosUrl !== null && supabaseUrl === normalizedPosUrl);
  const explicitPrefix = readEnv('COMMERCE_TABLE_PREFIX');
  const tablePrefix = explicitPrefix ?? (unifiedProject ? 'commerce_' : '');

  return {missing, invalid, supabaseUrl, serviceRoleKey, authJwtSecret, tablePrefix};
}

/**
 * Configuration loader for endpoints that only need Supabase (`/api/plans`,
 * `/api/subscription`, `/api/contact`) and do not initiate Paystack charges.
 */
export function getDatabaseConfig(request?: Request): ConfigResult {
  const base = resolveSupabaseBase();
  const appBaseUrlRaw = readEnv('APP_BASE_URL') ?? (request ? new URL(request.url).origin : undefined);
  let appBaseUrl = 'http://localhost:3000';
  if (appBaseUrlRaw) {
    const normalized = normalizeBaseUrl(appBaseUrlRaw);
    if (normalized) appBaseUrl = normalized;
  }

  if (base.missing.length > 0 || base.invalid.length > 0) {
    return {ok: false, missing: base.missing, invalid: base.invalid};
  }

  return {
    ok: true,
    config: {
      supabaseUrl: base.supabaseUrl as string,
      supabaseServiceRoleKey: base.serviceRoleKey as string,
      authJwtSecret: base.authJwtSecret,
      tablePrefix: base.tablePrefix,
      paystackSecretKey: readEnv('PAYSTACK_SECRET_KEY') ?? '',
      paystackWebhookSecret: readEnv('PAYSTACK_WEBHOOK_SECRET') ?? readEnv('PAYSTACK_SECRET_KEY') ?? '',
      paystackPublicKey: readEnv('PAYSTACK_PUBLIC_KEY'),
      paystackMode: 'test',
      appBaseUrl,
      installerBucket: readEnv('INSTALLER_BUCKET') ?? 'installers',
      downloadLinkTtlSeconds: DEFAULT_DOWNLOAD_TTL,
      checkoutEnabled: readFlag('CHECKOUT_ENABLED', true),
      publishPrices: readFlag('PUBLISH_PRICES', true),
      downloadAccessMode: 'entitlement',
      auditHashSalt: readEnv('AUDIT_HASH_SALT'),
    },
  };
}

/**
 * Full configuration loader for Paystack payment & verification endpoints.
 */
export function getCommerceConfig(request?: Request): ConfigResult {
  const base = resolveSupabaseBase();
  const missing = [...base.missing];
  const invalid = [...base.invalid];

  const paystackSecretKey = readEnv('PAYSTACK_SECRET_KEY');
  if (!paystackSecretKey) missing.push('PAYSTACK_SECRET_KEY');

  const appBaseUrlRaw =
    readEnv('APP_BASE_URL') ?? (request ? new URL(request.url).origin : undefined);
  if (!appBaseUrlRaw) missing.push('APP_BASE_URL');

  let paystackMode: 'test' | 'live' = 'test';
  if (paystackSecretKey !== undefined) {
    if (!paystackSecretKey.startsWith('sk_')) {
      invalid.push('PAYSTACK_SECRET_KEY');
    } else if (!paystackSecretKey.startsWith('sk_test_')) {
      if (readFlag('ALLOW_LIVE_PAYMENTS', false)) {
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
      supabaseUrl: base.supabaseUrl as string,
      supabaseServiceRoleKey: base.serviceRoleKey as string,
      authJwtSecret: base.authJwtSecret,
      tablePrefix: base.tablePrefix,
      paystackSecretKey: paystackSecretKey as string,
      paystackWebhookSecret: readEnv('PAYSTACK_WEBHOOK_SECRET') ?? (paystackSecretKey as string),
      paystackPublicKey: readEnv('PAYSTACK_PUBLIC_KEY'),
      paystackMode,
      appBaseUrl: appBaseUrl as string,
      installerBucket,
      downloadLinkTtlSeconds,
      checkoutEnabled: readFlag('CHECKOUT_ENABLED', true),
      publishPrices: readFlag('PUBLISH_PRICES', true),
      downloadAccessMode,
      auditHashSalt: readEnv('AUDIT_HASH_SALT'),
    },
  };
}
