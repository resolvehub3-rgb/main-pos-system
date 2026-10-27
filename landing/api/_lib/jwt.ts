/**
 * Server-side verification of Supabase Auth access tokens (JWTs).
 *
 * The browser sends its Supabase access token as `Authorization: Bearer
 * <jwt>`; this module validates it locally with WebCrypto so no extra
 * network call is needed per request.
 *
 * Checks performed, in order:
 *  1. three non-empty dot-separated segments,
 *  2. header `alg` must be exactly `HS256` (rejects `none` and any
 *     algorithm confusion attempt),
 *  3. HMAC-SHA256 signature over `header.payload` using the project's JWT
 *     secret (constant-time verification inside WebCrypto),
 *  4. `exp` present and in the future (30 s clock skew allowed),
 *  5. `nbf`, when present, not in the future,
 *  6. `sub` present (the user id),
 *  7. `iss` matches the commerce project's auth issuer,
 *  8. `aud` and `role` are `authenticated` (an anon token can never pass).
 *
 * ASSUMPTION (documented in docs/02-commerce-architecture.md): the future
 * commerce Supabase project issues HS256 access tokens, which is Supabase's
 * default. If the project is later switched to asymmetric JWTs, replace
 * this module with an introspection call to `{SUPABASE_URL}/auth/v1/user`.
 */

import {base64UrlToBytes, utf8ToBytes} from './codec.ts';

export interface JwtClaims {
  sub: string;
  role: string;
  email?: string;
  exp: number;
  iss?: string;
  aud?: string;
}

export interface JwtVerifyOptions {
  secret: string;
  /** e.g. `https://<project>.supabase.co/auth/v1` (trailing slash tolerated). */
  expectedIssuer?: string;
  expectedAudience?: string;
  nowSeconds?: number;
  clockSkewSeconds?: number;
}

export type JwtResult = {ok: true; claims: JwtClaims} | {ok: false; reason: string};

interface DecodedHeader {
  alg?: unknown;
}

export async function verifySupabaseJwt(token: string, options: JwtVerifyOptions): Promise<JwtResult> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return {ok: false, reason: 'malformed_token'};
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: DecodedHeader;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerPart))) as DecodedHeader;
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart))) as Record<string, unknown>;
  } catch {
    return {ok: false, reason: 'malformed_token'};
  }

  // Reject "none" and any non-HS256 algorithm before trusting any claim.
  if (header.alg !== 'HS256') {
    return {ok: false, reason: 'unsupported_algorithm'};
  }

  let signatureValid = false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      utf8ToBytes(options.secret),
      {name: 'HMAC', hash: 'SHA-256'},
      false,
      ['verify'],
    );
    signatureValid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signaturePart),
      utf8ToBytes(`${headerPart}.${payloadPart}`),
    );
  } catch {
    return {ok: false, reason: 'bad_signature'};
  }
  if (!signatureValid) {
    return {ok: false, reason: 'bad_signature'};
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? 30;

  const exp = payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return {ok: false, reason: 'missing_exp'};
  }
  if (now - skew >= exp) {
    return {ok: false, reason: 'token_expired'};
  }

  const nbf = payload.nbf;
  if (typeof nbf === 'number' && now + skew < nbf) {
    return {ok: false, reason: 'token_not_yet_valid'};
  }

  const sub = payload.sub;
  if (typeof sub !== 'string' || sub.length === 0) {
    return {ok: false, reason: 'missing_sub'};
  }

  // Supabase access tokens carry role=authenticated; an anon token must not
  // authenticate against the commerce API.
  if (payload.role !== 'authenticated') {
    return {ok: false, reason: 'wrong_role'};
  }

  if (options.expectedIssuer !== undefined) {
    const normalise = (value: string): string => value.replace(/\/+$/, '');
    const issuer = typeof payload.iss === 'string' ? normalise(payload.iss) : '';
    if (issuer !== normalise(options.expectedIssuer)) {
      return {ok: false, reason: 'issuer_mismatch'};
    }
  }

  if (options.expectedAudience !== undefined && payload.aud !== options.expectedAudience) {
    return {ok: false, reason: 'audience_mismatch'};
  }

  const claims: JwtClaims = {
    sub,
    role: String(payload.role),
    exp,
  };
  if (typeof payload.iss === 'string') claims.iss = payload.iss;
  if (typeof payload.aud === 'string') claims.aud = payload.aud;
  if (typeof payload.email === 'string') claims.email = payload.email;

  return {ok: true, claims};
}
