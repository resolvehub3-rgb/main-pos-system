/**
 * Request authentication for the commerce API.
 *
 * Flow (client side, implemented later — see docs/02):
 *   1. the customer signs in to the *commerce* Supabase project (email OTP),
 *   2. the browser stores the access token and sends it on every request as
 *      `Authorization: Bearer <access token>`,
 *   3. each function calls requireSession() below.
 *
 * The POS application's authentication is never involved: separate project,
 * separate keys, separate users.
 *
 * Tokens are accepted from the Authorization header ONLY — never from a query
 * parameter or cookie we would have to trust the client about.
 */

import type {CommerceConfig} from './env.ts';
import {base64UrlToBytes} from './codec.ts';
import {apiError, bearerToken} from './http.ts';
import {verifySupabaseJwt} from './jwt.ts';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
}

export type SessionResult =
  | {ok: true; user: AuthenticatedUser}
  | {ok: false; response: Response};

function readTokenAlg(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0]) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0]))) as {alg?: unknown};
    return typeof header.alg === 'string' ? header.alg : null;
  } catch {
    return null;
  }
}

async function verifyViaSupabaseAuthApi(
  token: string,
  config: CommerceConfig,
): Promise<{ok: true; user: AuthenticatedUser} | {ok: false; reason: string}> {
  let response: Response;
  try {
    response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return {ok: false, reason: 'auth_api_unreachable'};
  }

  if (!response.ok) {
    return {ok: false, reason: `auth_api_rejected_${response.status}`};
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    return {ok: false, reason: 'auth_api_bad_json'};
  }

  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
  const id = record && typeof record.id === 'string' ? record.id : '';
  if (!id) {
    return {ok: false, reason: 'auth_api_missing_user_id'};
  }

  const user: AuthenticatedUser = {userId: id};
  if (typeof record?.email === 'string' && record.email.length > 0) {
    user.email = record.email;
  }
  return {ok: true, user};
}

export async function requireSession(request: Request, config: CommerceConfig): Promise<SessionResult> {
  const token = bearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: apiError(401, 'authentication_required', 'Sign in with your SamTill account first.'),
    };
  }

  const alg = readTokenAlg(token);
  if (config.authJwtSecret && alg === 'HS256') {
    const result = await verifySupabaseJwt(token, {
      secret: config.authJwtSecret,
      expectedIssuer: `${config.supabaseUrl}/auth/v1`,
      expectedAudience: 'authenticated',
    });

    if (!result.ok) {
      console.warn(`commerce: session rejected (${result.reason})`);
      return {
        ok: false,
        response: apiError(401, 'invalid_session', 'Your session is invalid or has expired. Sign in again.'),
      };
    }

    const user: AuthenticatedUser = {userId: result.claims.sub};
    if (result.claims.email !== undefined) user.email = result.claims.email;
    return {ok: true, user};
  }

  // Asymmetric Supabase JWTs (ES256 / RS256) or deployments without a local HS256 secret
  // are verified authoritatively against Supabase Auth /auth/v1/user.
  const remote = await verifyViaSupabaseAuthApi(token, config);
  if (!remote.ok) {
    console.warn(`commerce: session rejected (${remote.reason})`);
    return {
      ok: false,
      response: apiError(401, 'invalid_session', 'Your session is invalid or has expired. Sign in again.'),
    };
  }

  return {ok: true, user: remote.user};
}
