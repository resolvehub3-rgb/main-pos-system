/**
 * Public configuration + Supabase client for the CUSTOMER account area.
 *
 * Reads only public, browser-safe values compiled in by Vite:
 *   VITE_COMMERCE_SUPABASE_URL       — dedicated commerce project URL
 *   VITE_COMMERCE_SUPABASE_ANON_KEY  — publishable/anon key (designed to be
 *                                      public; cannot bypass RLS)
 *   VITE_COMMERCE_API_BASE           — optional API origin; '' = same origin
 *
 * SEPARATION RULE (docs/02): this is the future `samtill-commerce` project —
 * NEVER the POS application's Supabase project, its keys or its `.env`.
 * No service-role key or server secret is ever read here or anywhere in the
 * browser bundle.
 *
 * When the variables are absent the client is `null` and the account screens
 * render a plain "not configured" notice instead of a form (see
 * src/lib/availability.ts).
 */

import {createClient, type SupabaseClient} from '@supabase/supabase-js';

export interface PublicCommerceEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBase: string;
}

function envValue(key: string): string {
  const raw = import.meta.env[key] as string | undefined;
  return typeof raw === 'string' ? raw.trim() : '';
}

export function readCommerceEnv(): PublicCommerceEnv {
  return {
    supabaseUrl: envValue('VITE_COMMERCE_SUPABASE_URL'),
    supabaseAnonKey: envValue('VITE_COMMERCE_SUPABASE_ANON_KEY'),
    apiBase: envValue('VITE_COMMERCE_API_BASE'),
  };
}

let client: SupabaseClient | null = null;

/**
 * The auth client for customer accounts, or null when unconfigured.
 * The session persists in localStorage (restored after a page refresh) and
 * auto-refreshes while the tab is open.
 *
 * `detectSessionInUrl` is disabled on purpose: verification links are handled
 * explicitly by the verify screen so that the hash router and the provider's
 * redirect parameters cannot interfere with each other.
 */
export function getCommerceAuth(): SupabaseClient | null {
  const env = readCommerceEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  if (client) return client;

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
}
