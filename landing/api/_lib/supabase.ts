/**
 * Thin server-side client for the *commerce* Supabase project.
 *
 * Deliberately not the Supabase JS SDK: these functions only need a handful
 * of REST calls, and keeping it dependency-free means the exact code that
 * will run on Vercel is what the local tests and type checks cover.
 *
 * SECURITY INVARIANTS
 *  - Only the service-role key is used, and only inside serverless
 *    functions. It is read from the validated CommerceConfig and never
 *    logged, never returned in a response, never sent to the browser.
 *  - Table names are validated against a strict identifier pattern before
 *    being placed in a URL (values are always URI-encoded).
 *  - Every helper is used against the commerce project URL only.
 */

import type {CommerceConfig} from './env.ts';

export class BackendError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
  }
}

const TABLE_RE = /^[a-z_][a-z0-9_]*$/;

interface CallOptions {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function call(cfg: CommerceConfig, options: CallOptions): Promise<{status: number; data: unknown}> {
  const headers: Record<string, string> = {
    apikey: cfg.supabaseServiceRoleKey,
    authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
    ...options.headers,
  };

  let response: Response;
  try {
    response = await fetch(options.url, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    // Network-level failure. Message contains no secrets (URL has no keys).
    throw new BackendError(`commerce backend unreachable: ${String(cause)}`, 503);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    // PostgREST error bodies carry table/constraint details only — safe to
    // surface in server logs, still never include headers or keys.
    const detail = typeof data === 'object' && data !== null ? JSON.stringify(data).slice(0, 300) : '';
    throw new BackendError(
      `supabase ${options.method} failed (${response.status})${detail ? `: ${detail}` : ''}`,
      response.status,
    );
  }

  return {status: response.status, data};
}

function assertTable(table: string): void {
  if (!TABLE_RE.test(table)) {
    throw new BackendError(`unsafe table name: ${table}`, 500);
  }
}

/** GET rows. `query` is a PostgREST query string built by the caller. */
export async function selectRows<T>(cfg: CommerceConfig, table: string, query: string): Promise<T[]> {
  assertTable(table);
  const url = `${cfg.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const {data} = await call(cfg, {method: 'GET', url, headers: {prefer: 'return=representation'}});
  if (!Array.isArray(data)) return [];
  return data as T[];
}

export interface InsertOptions {
  /** When set, conflicting rows are ignored instead of raising an error. */
  ignoreDuplicates?: boolean;
  onConflict?: string;
}

/** INSERT rows, returning the inserted representation. */
export async function insertRow<T>(
  cfg: CommerceConfig,
  table: string,
  row: Record<string, unknown>,
  options: InsertOptions = {},
): Promise<T[]> {
  assertTable(table);
  const params = new URLSearchParams();
  if (options.ignoreDuplicates && options.onConflict) {
    params.set('on_conflict', options.onConflict);
  }
  const query = params.toString();
  const url = `${cfg.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;

  const headers: Record<string, string> = {prefer: 'return=representation'};
  if (options.ignoreDuplicates && options.onConflict) {
    headers.prefer += ',resolution=ignore-duplicates';
  }

  const {data} = await call(cfg, {method: 'POST', url, body: row, headers});
  if (!Array.isArray(data)) return [];
  return data as T[];
}

/**
 * PATCH rows matching `query`. Returns the updated rows — callers rely on
 * the length to detect lost races (e.g. `reference=eq.X&status=eq.pending`
 * matching zero rows means another path already applied the payment).
 */
export async function updateRows<T>(
  cfg: CommerceConfig,
  table: string,
  query: string,
  patch: Record<string, unknown>,
): Promise<T[]> {
  assertTable(table);
  const url = `${cfg.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const {data} = await call(cfg, {
    method: 'PATCH',
    url,
    body: patch,
    headers: {prefer: 'return=representation'},
  });
  if (!Array.isArray(data)) return [];
  return data as T[];
}

/**
 * Mint a short-lived signed URL for an object in a private bucket.
 * Only the service role can do this; there is no public object policy.
 */
export async function createSignedObjectUrl(
  cfg: CommerceConfig,
  bucket: string,
  objectPath: string,
  ttlSeconds: number,
): Promise<string> {
  if (objectPath.startsWith('/') || objectPath.includes('..')) {
    throw new BackendError(`unsafe object path: ${objectPath}`, 500);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(bucket)) {
    throw new BackendError(`unsafe bucket name: ${bucket}`, 500);
  }

  const url = `${cfg.supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath}`;
  const {data} = await call(cfg, {
    method: 'POST',
    url,
    body: {expiresIn: ttlSeconds},
    headers: {prefer: 'return=representation'},
  });

  const signed = (data as {signedURL?: string} | null)?.signedURL;
  if (typeof signed !== 'string' || signed === '') {
    throw new BackendError('signed URL missing from storage response', 502);
  }
  return `${cfg.supabaseUrl}/storage/v1${signed}`;
}
