/**
 * Thin adapter: `@supabase/supabase-js` → the AuthProvider interface that
 * src/lib/authFlow.ts drives.
 *
 * All interpretation of provider responses/errors happens in authFlow.ts
 * (unit-tested); this file only reshapes the SDK's return values.
 */

import type {EmailOtpType, SupabaseClient} from '@supabase/supabase-js';
import type {AuthProvider, AuthErrorLike, AuthSessionLike, AuthUserLike} from './authFlow.ts';

function toError(error: {code?: string; message?: string} | null): AuthErrorLike | null {
  if (!error) return null;
  const mapped: AuthErrorLike = {};
  if (error.code !== undefined) mapped.code = error.code;
  if (error.message !== undefined) mapped.message = error.message;
  return mapped;
}

function toSession(session: {access_token: string; user?: {id: string; email?: string}} | null | undefined): AuthSessionLike | null {
  if (!session) return null;
  const out: AuthSessionLike = {access_token: session.access_token};
  if (session.user) {
    const user: AuthUserLike = {id: session.user.id};
    if (session.user.email !== undefined) user.email = session.user.email;
    out.user = user;
  }
  return out;
}

export function createAuthProvider(client: SupabaseClient): AuthProvider {
  return {
    async signUp(input) {
      const {data, error} = await client.auth.signUp({
        email: input.email,
        password: input.password,
        ...(input.data ? {data: input.data} : {}),
        ...(input.options ? {options: input.options} : {}),
      });
      const identities = data.user?.identities ?? null;
      return {
        user: data.user ? {id: data.user.id, ...(data.user.email ? {email: data.user.email} : {})} : null,
        session: toSession(data.session),
        identities,
        error: toError(error),
      };
    },

    async signInWithPassword(input) {
      const {data, error} = await client.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });
      return {session: toSession(data.session), error: toError(error)};
    },

    async verifyOtp(input) {
      const {data, error} = await client.auth.verifyOtp({
        token_hash: input.tokenHash,
        type: input.type as EmailOtpType,
      });
      return {session: toSession(data.session), error: toError(error)};
    },

    async exchangeCodeForSession(code) {
      const {data, error} = await client.auth.exchangeCodeForSession(code);
      return {session: toSession(data.session), error: toError(error)};
    },

    async resetPasswordForEmail(email, options) {
      const {error} = await client.auth.resetPasswordForEmail(email, {
        ...(options.redirectTo ? {redirectTo: options.redirectTo} : {}),
      });
      return {error: toError(error)};
    },

    async resendConfirmationEmail(email, options) {
      const {error} = await client.auth.resend({
        type: 'signup',
        email,
        ...(options.redirectTo ? {options: {emailRedirectTo: options.redirectTo}} : {}),
      });
      return {error: toError(error)};
    },

    async updateUserPassword(password) {
      const {error} = await client.auth.updateUser({password});
      return {error: toError(error)};
    },

    async signOut() {
      const {error} = await client.auth.signOut();
      return {error: toError(error)};
    },
  };
}
