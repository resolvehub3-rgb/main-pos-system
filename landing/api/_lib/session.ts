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
import {apiError, bearerToken} from './http.ts';
import {verifySupabaseJwt} from './jwt.ts';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
}

export type SessionResult =
  | {ok: true; user: AuthenticatedUser}
  | {ok: false; response: Response};

export async function requireSession(request: Request, config: CommerceConfig): Promise<SessionResult> {
  const token = bearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: apiError(401, 'authentication_required', 'Sign in with your SamTill account first.'),
    };
  }

  const result = await verifySupabaseJwt(token, {
    secret: config.authJwtSecret,
    expectedIssuer: `${config.supabaseUrl}/auth/v1`,
    expectedAudience: 'authenticated',
  });

  if (!result.ok) {
    // The specific reason stays in the server log only — the client just
    // learns that the session is unusable (no oracle for probing tokens).
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
