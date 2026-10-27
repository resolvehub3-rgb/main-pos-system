/**
 * Minimal HTTP helpers for the commerce functions.
 *
 * Vercel functions here use the web-standard handler signature
 * (`export function POST(request: Request): Response`), so everything below
 * is built on Request/Response — no framework types, no Node.js imports.
 *
 * Responses carrying commerce data are always `no-store`: entitlement,
 * subscription and download answers must never be cached by intermediaries.
 */

import {constantTimeEquals, utf8ToBytes, type Bytes} from './codec.ts';

export const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {...JSON_HEADERS, ...extraHeaders},
  });
}

export interface ApiErrorOptions {
  headers?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export function apiError(status: number, error: string, message?: string, options: ApiErrorOptions = {}): Response {
  const body: Record<string, unknown> = {error};
  if (message !== undefined) body.message = message;
  if (options.extra !== undefined) Object.assign(body, options.extra);
  return json(body, status, options.headers);
}

/** Returns a 405 response when the request method is not allowed, else null. */
export function methodGuard(request: Request, ...allowed: string[]): Response | null {
  const method = (request.method ?? 'GET').toUpperCase();
  if (allowed.includes(method)) return null;
  return apiError(405, 'method_not_allowed', `This endpoint only accepts ${allowed.join(', ')}.`, {
    headers: {allow: allowed.join(', ')},
  });
}

/** Fail-closed response used when the commerce backend is not provisioned. */
export function notConfigured(missing: string[], invalid: string[] = []): Response {
  return apiError(503, 'commerce_not_configured', 'The commerce backend is not configured yet.', {
    extra: {missing, invalid},
  });
}

export function rateLimited(retryAfterSeconds: number): Response {
  return apiError(429, 'rate_limited', 'Too many requests. Please wait and try again.', {
    headers: {'retry-after': String(retryAfterSeconds)},
  });
}

export type BodyResult<T> = {ok: true; value: T} | {ok: false; response: Response};

/**
 * Read and parse a JSON body with a hard size limit.
 * The Content-Length header is checked first (cheap rejection), then the
 * decoded body is checked again for chunked requests.
 */
export async function readJsonBody<T = unknown>(request: Request, limitBytes = 64 * 1024): Promise<BodyResult<T>> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return {ok: false, response: apiError(415, 'unsupported_media_type', 'Expected a JSON body.')};
  }

  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    return {ok: false, response: apiError(413, 'payload_too_large', 'Request body is too large.')};
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return {ok: false, response: apiError(400, 'invalid_body', 'Could not read the request body.')};
  }

  if (utf8ToBytes(text).length > limitBytes) {
    return {ok: false, response: apiError(413, 'payload_too_large', 'Request body is too large.')};
  }
  if (text.trim() === '') {
    return {ok: false, response: apiError(400, 'invalid_body', 'Request body is empty.')};
  }

  try {
    return {ok: true, value: JSON.parse(text) as T};
  } catch {
    return {ok: false, response: apiError(400, 'invalid_json', 'Request body is not valid JSON.')};
  }
}

/**
 * Best-effort client IP. Vercel sets x-forwarded-for; the first hop is the
 * caller. Used only for rate limiting and salted audit hashing.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp || null;
}

/** Extract a `Bearer` token from the Authorization header (case-insensitive). */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function sha256Hex(data: Bytes | string): Promise<string> {
  const bytes = typeof data === 'string' ? utf8ToBytes(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Re-export so callers only need one import for constant-time compares. */
export {constantTimeEquals};
