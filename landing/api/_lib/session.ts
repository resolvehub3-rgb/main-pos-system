/**
 * Request authentication for the commerce API.
 *
 * Verifies the Bearer access token either locally using HS256 JWT secret (if
 * configured) or directly via Supabase Auth's `/auth/v1/user` verification
 * endpoint (supports asymmetric ES256/RS256 tokens and zero-secret setups).
 */

import type {CommerceConfig} from './env.ts';
import {apiError, bearerToken} from './http.ts';
import {verifySupabaseJwt} from './jwt.ts';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
}

export type SessionResult =
  | {ok: true; user: AuthenticatedUser}
  | {ok: false; response: Response};

async function verifyViaSupabaseAuth(token: string, config: CommerceConfig): Promise<AuthenticatedUser | null> {
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {id?: unknown; email?: unknown} | null;
    if (!data || typeof data.id !== 'string' || data.id === '') return null;
    const user: AuthenticatedUser = {userId: data.id};
    if (typeof data.email === 'string' && data.email !== '') {
      user.email = data.email;
    }
    return user;
  } catch {
    return null;
  }
}

export async function requireSession(request: Request, config: CommerceConfig): Promise<SessionResult> {
  const token = bearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: apiError(401, 'authentication_required', 'Sign in with your SamTill account first.'),
    };
  }

  if (config.authJwtSecret) {
    const result = await verifySupabaseJwt(token, {
      secret: config.authJwtSecret,
      expectedIssuer: `${config.supabaseUrl}/auth/v1`,
      expectedAudience: 'authenticated',
    });

    if (result.ok) {
      const user: AuthenticatedUser = {userId: result.claims.sub};
      if (result.claims.email !== undefined) user.email = result.claims.email;
      return {ok: true, user};
    }

    // If token uses an asymmetric algorithm (ES256/RS256), fall through to
    // Supabase Auth's live /auth/v1/user verification before rejecting.
    if (result.reason !== 'unsupported_alg') {
      console.warn(`commerce: session rejected (${result.reason})`);
      return {
        ok: false,
        response: apiError(401, 'invalid_session', 'Your session is invalid or has expired. Sign in again.'),
      };
    }
  }

  const user = await verifyViaSupabaseAuth(token, config);
  if (!user) {
    return {
      ok: false,
      response: apiError(401, 'invalid_session', 'Your session is invalid or has expired. Sign in again.'),
    };
  }

  return {ok: true, user};
}
