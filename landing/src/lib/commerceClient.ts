/**
 * Public configuration + Supabase client for SamTill customer & POS accounts.
 *
 * Reads only public, browser-safe values compiled statically by Vite:
 *   VITE_COMMERCE_SUPABASE_URL / VITE_SUPABASE_URL
 *   VITE_COMMERCE_SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY
 *   VITE_COMMERCE_API_BASE
 *
 * Uses the same localStorage session key (`sb-pos-auth`) as the SamTill POS
 * application so registering or signing in on the marketing/checkout flow
 * stays authenticated inside `/app/*`.
 */

import {createClient, type SupabaseClient} from '@supabase/supabase-js';

export interface PublicCommerceEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBase: string;
}

function readRuntimeSupabaseOverride(): {url?: string; anonKey?: string} {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem('samtech_supabase_config');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {url?: unknown; anonKey?: unknown};
    return {
      url: typeof parsed.url === 'string' ? parsed.url.trim() : undefined,
      anonKey: typeof parsed.anonKey === 'string' ? parsed.anonKey.trim() : undefined,
    };
  } catch {
    return {};
  }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readCommerceEnv(): PublicCommerceEnv {
  // Static property accesses are mandatory so Vite replaces env values at build time.
  const metaEnv = (import.meta as {env?: Record<string, string | undefined>}).env;
  const runtimeOverride = readRuntimeSupabaseOverride();

  const supabaseUrl =
    clean(metaEnv?.VITE_COMMERCE_SUPABASE_URL) ||
    clean(metaEnv?.VITE_SUPABASE_URL) ||
    clean(runtimeOverride.url);

  const supabaseAnonKey =
    clean(metaEnv?.VITE_COMMERCE_SUPABASE_ANON_KEY) ||
    clean(metaEnv?.VITE_SUPABASE_ANON_KEY) ||
    clean(runtimeOverride.anonKey);

  const apiBase = clean(metaEnv?.VITE_COMMERCE_API_BASE);

  return {
    supabaseUrl,
    supabaseAnonKey,
    apiBase,
  };
}

let client: SupabaseClient | null = null;
let cachedConfigKey = '';

/**
 * Auth client for customer accounts, or null when unconfigured.
 * Uses `sb-pos-auth` storageKey to match the SamTill POS SPA.
 */
export function getCommerceAuth(): SupabaseClient | null {
  const env = readCommerceEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;

  const configKey = `${env.supabaseUrl}::${env.supabaseAnonKey}`;
  if (client && cachedConfigKey === configKey) return client;

  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'sb-pos-auth',
    },
  });
  cachedConfigKey = configKey;
  return client;
}

/** Reset the cached client (used by tests; harmless in the browser). */
export function resetCommerceAuthForTests(): void {
  client = null;
  cachedConfigKey = '';
}
