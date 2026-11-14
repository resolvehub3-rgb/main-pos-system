/**
 * Public configuration + Supabase client for the customer account & subscription area.
 *
 * Reads ONLY public, browser-safe values via static Vite `import.meta.env?.VITE_*`
 * member accesses (never reading secret keys, and never using dynamic indexing
 * that could leak unrelated build variables).
 *
 * Unified configuration: uses `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
 * directly from the main POS Supabase project (while still honoring optional
 * `VITE_COMMERCE_SUPABASE_URL` / `VITE_COMMERCE_SUPABASE_ANON_KEY` overrides).
 */

import {createClient, type SupabaseClient} from '@supabase/supabase-js';

const ENV_COMMERCE_URL: string = import.meta.env?.VITE_COMMERCE_SUPABASE_URL ?? '';
const ENV_COMMERCE_ANON_KEY: string = import.meta.env?.VITE_COMMERCE_SUPABASE_ANON_KEY ?? '';
const ENV_SUPABASE_URL: string = import.meta.env?.VITE_SUPABASE_URL ?? '';
const ENV_SUPABASE_ANON_KEY: string = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '';
const ENV_COMMERCE_API_BASE: string = import.meta.env?.VITE_COMMERCE_API_BASE ?? '';

const STORAGE_KEY_CONFIG = 'samtech_supabase_config';

export interface PublicCommerceEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBase: string;
}

function readLocalPosConfig(): {url: string; anonKey: string} {
  if (typeof window === 'undefined') return {url: '', anonKey: ''};
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return {url: '', anonKey: ''};
    const parsed = JSON.parse(raw) as {url?: unknown; anonKey?: unknown};
    return {
      url: typeof parsed.url === 'string' ? parsed.url.trim() : '',
      anonKey: typeof parsed.anonKey === 'string' ? parsed.anonKey.trim() : '',
    };
  } catch {
    return {url: '', anonKey: ''};
  }
}

function cleanValue(value: string, placeholderToken: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(placeholderToken)) return '';
  return trimmed;
}

export function readCommerceEnv(): PublicCommerceEnv {
  const local = readLocalPosConfig();
  const rawUrl = cleanValue(ENV_COMMERCE_URL, 'your-project.supabase.co') ||
    cleanValue(ENV_SUPABASE_URL, 'your-project.supabase.co') ||
    cleanValue(local.url, 'your-project.supabase.co');
  const rawKey = cleanValue(ENV_COMMERCE_ANON_KEY, 'your-anon-key') ||
    cleanValue(ENV_SUPABASE_ANON_KEY, 'your-anon-key') ||
    cleanValue(local.anonKey, 'your-anon-key');
  const apiBase = ENV_COMMERCE_API_BASE.trim();
  return {supabaseUrl: rawUrl, supabaseAnonKey: rawKey, apiBase};
}

let client: SupabaseClient | null = null;
let clientConfigKey = '';

/**
 * The auth client for customer accounts, or null when Supabase env vars are absent.
 */
export function getCommerceAuth(): SupabaseClient | null {
  const env = readCommerceEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  const key = `${env.supabaseUrl}::${env.supabaseAnonKey}`;
  if (client && clientConfigKey === key) return client;

  clientConfigKey = key;
  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'samtill_commerce_auth',
    },
  });
  return client;
}

/** Reset the cached client (used by tests; harmless in the browser). */
export function resetCommerceAuthForTests(): void {
  client = null;
  clientConfigKey = '';
}
