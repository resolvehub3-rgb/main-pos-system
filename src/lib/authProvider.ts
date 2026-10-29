import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserAccount, UserRole } from '../types/index.ts';

/**
 * Supabase Auth adapter for the POS.
 *
 * This module is the ONLY place the app talks to Supabase Auth. It is kept
 * free of module-level singletons and takes its client as an argument so the
 * resolution and sign-in logic can be unit-tested against a stub client with
 * no network, no Vite env and no real Supabase project.
 *
 * Design rules (see docs/SECURITY.md):
 *  - Online sign-in is `auth.signInWithPassword` — the password NEVER touches
 *    this app's own comparison logic and is never stored or mirrored.
 *  - The application user is resolved from `auth.uid()` via `profiles` (the
 *    authoritative role) and `tenant_memberships` (the tenant scope). The
 *    `public.users` roster row supplies the app-facing fields and `is_active`.
 *  - A role is NEVER taken from the client or inferred. It is read from the
 *    server-side `profiles.role` row, which the DB trigger protects from
 *    self-escalation. A profile that is missing, inactive, or has no active
 *    membership is refused — not silently granted access.
 */

/**
 * The only roster columns the sign-in flow may pull from `public.users`.
 *
 * Deliberately excludes `password` and `pin`. Even though the Stage B migration
 * scrubs those, selecting `*` would copy any credential that still exists onto
 * every device that signs in. Explicit columns are a permanent constraint, not
 * a temporary one.
 */
export const REMOTE_USER_COLUMNS =
  'id,tenant_id,shop_name,full_name,email,phone,role,is_active,created_at';

/** The `profiles` columns the resolver needs. Role is the authoritative field. */
const PROFILE_COLUMNS = 'id,role,full_name,email,phone';

/** Result of resolving the Supabase Auth identity into an application user. */
export type AuthResolveResult =
  | { ok: true; user: UserAccount }
  | { ok: false; code: 'no_session' | 'no_profile' | 'no_membership' | 'no_roster' | 'inactive'; message: string };

/** Minimal structural view of the Supabase client this adapter depends on. */
export interface SupabaseAuthClient {
  auth: {
    signInWithPassword(params: {
      email: string;
      password: string;
    }): PromiseLike<{
      data: {
        user: {
          id: string;
          email?: string;
          user_metadata?: Record<string, unknown>;
        } | null;
        session: unknown;
      };
      error: { message: string } | null;
    }>;
    signOut(): PromiseLike<{ error: { message: string } | null }>;
    getSession(): PromiseLike<{ data: { session: unknown }; error: unknown }>;
    signUp(params: {
      email: string;
      password: string;
      options?: { data?: Record<string, unknown> };
    }): PromiseLike<{
      data: { user: { id: string; email?: string } | null; session: unknown };
      error: { message: string } | null;
    }>;
    onAuthStateChange(
      cb: (event: string, session: { user?: { id: string; email?: string } } | null) => void
    ): { data: { subscription: { unsubscribe(): void } } };
  };
  // The real PostgREST query builder is richly typed; the resolver only chains
  // select().eq().limit() and reads { data, error }. Keeping this `any` lets the
  // genuine SupabaseClient satisfy the structural type while a test stub can
  // hand back a plain object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, params?: Record<string, unknown>): any;
}

/**
 * Turn a raw Supabase Auth error into the message shown on the sign-in form.
 * Supabase messages are developer-facing and sometimes leak structure; these
 * are the only strings a user ever sees from a failed online sign-in.
 */
export function classifySignInError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'Incorrect email or password. Please verify and try again.';
  }
  if (m.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many sign-in attempts. Please wait a moment and try again.';
  }
  if (m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return 'Sign-in failed. Please verify your credentials and try again.';
}

/**
 * Sign in to Supabase Auth with an email + password.
 *
 * Supabase Auth identifies users by email only. Phone and staff-username
 * sign-in remain a device-local convenience (see the fallback path in
 * `DatabaseService.login`); a first sign-in on a new online till is by email.
 *
 * On success the Auth session user is returned so the caller can resolve the
 * application identity from `auth.uid()` without a second round-trip.
 */
export async function signInWithSupabase(
  client: SupabaseAuthClient,
  email: string,
  password: string
): Promise<
  | { ok: true; user: { id: string; email?: string; user_metadata?: Record<string, unknown> } }
  | { ok: false; message: string }
> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: classifySignInError(error.message) };
  const user = data?.user;
  if (!user) {
    return { ok: false, message: 'Sign-in succeeded but no user was returned. Please try again.' };
  }
  return { ok: true, user: { id: user.id, email: user.email, user_metadata: user.user_metadata } };
}

/** Result of the trusted online new-shop provisioning flow. */
export type ProvisionResult =
  | { ok: true; authUser: { id: string; email?: string }; tenantId: string }
  | { ok: false; message: string; needsEmailConfirmation?: boolean };

/**
 * Create a new shop owner + shop entirely through trusted server-side calls.
 *
 * The client NEVER inserts a tenant, profile or membership row directly. It:
 *   1. Calls `auth.signUp` to create the Supabase Auth identity (password is
 *      hashed server-side by Supabase; it never reaches this app's storage).
 *   2. Calls the SECURITY DEFINER RPC `create_tenant_with_owner`, which runs
 *      inside the database, keys everything to `auth.uid()`, pins the role to
 *      `shop_owner`, and can never mint a super admin.
 *
 * If email confirmation is required by the project, `signUp` returns no session
 * and the RPC cannot run yet (it needs `auth.uid()`). In that case we report
 * `needsEmailConfirmation` so the UI can tell the owner to confirm first; the
 * provisioning is completed on their first sign-in (see `DatabaseService.login`
 * which calls the same RPC when a signed-in identity has no shop yet).
 */
export async function signUpAndProvisionShop(
  client: SupabaseAuthClient,
  params: {
    email: string;
    password: string;
    shopName: string;
    shopAddress?: string;
    fullName: string;
    phone: string;
  }
): Promise<ProvisionResult> {
  const { data, error } = await client.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      data: {
        full_name: params.fullName,
        shop_name: params.shopName,
        shop_address: params.shopAddress ?? null,
        phone: params.phone,
      },
    },
  });
  if (error) return { ok: false, message: classifySignInError(error.message) };

  const authUser = data?.user;
  if (!authUser) {
    return { ok: false, message: 'Sign-up succeeded but no user was returned. Please try again.' };
  }

  // With email confirmation on, there is no session yet, so auth.uid() is not
  // available to the RPC. Report back so the UI can ask the owner to confirm;
  // the shop is provisioned on their first confirmed sign-in.
  if (!data?.session) {
    return {
      ok: false,
      needsEmailConfirmation: true,
      message:
        'Almost there — check your inbox and confirm your email address, then sign in to finish setting up your shop.',
    };
  }

  const { data: tenantId, error: rpcError } = await client.rpc('create_tenant_with_owner', {
    p_shop_name: params.shopName,
    p_shop_address: params.shopAddress ?? null,
    p_owner_name: params.fullName,
    p_owner_phone: params.phone,
  });
  if (rpcError) {
    return { ok: false, message: `Could not create your shop: ${rpcError.message}` };
  }
  if (!tenantId) {
    return { ok: false, message: 'Could not create your shop: no shop id was returned.' };
  }
  return { ok: true, authUser: { id: authUser.id, email: authUser.email }, tenantId: String(tenantId) };
}

/**
 * Resolve the current signed-in identity's shop, provisioning one via the
 * trusted RPC when the identity has a profile but no active membership yet.
 *
 * This is the "finish setup after email confirmation" path: a user who signed
 * up (confirming their email) and then signed in has an auth.uid() + profile
 * but may not yet own a shop if the RPC could not run during signUp. Calling
 * `create_tenant_with_owner` here is safe and idempotent — the RPC returns the
 * existing tenant if one is already owned.
 */
export async function ensureOwnerShop(
  client: SupabaseAuthClient,
  params: { shopName: string; shopAddress?: string; fullName: string; phone: string }
): Promise<{ ok: true; tenantId: string } | { ok: false; message: string }> {
  const { data: tenantId, error } = await client.rpc('create_tenant_with_owner', {
    p_shop_name: params.shopName,
    p_shop_address: params.shopAddress ?? null,
    p_owner_name: params.fullName,
    p_owner_phone: params.phone,
  });
  if (error) return { ok: false, message: `Could not set up your shop: ${error.message}` };
  if (!tenantId) return { ok: false, message: 'Could not set up your shop: no shop id was returned.' };
  return { ok: true, tenantId: String(tenantId) };
}

/**
 * Resolve the Supabase Auth identity into an application user, scoped by RLS
 * to whatever that identity is allowed to see.
 *
 * Order of authority:
 *   1. `profiles.role` — the authoritative, DB-protected role for this
 *      `auth.uid()`. Never taken from the client or inferred.
 *   2. `tenant_memberships` — proves the identity belongs to an ACTIVE tenant.
 *      No active membership means no shop, so sign-in is refused.
 *   3. `public.users` — the app roster row, matched by the verified email. It
 *      supplies `is_active`, `shop_name`, phone and the app-facing id.
 *
 * Every read is an explicit column list; `password`/`pin` are never selected.
 */
export async function resolveAuthUser(
  client: SupabaseAuthClient,
  sessionUser: { id: string; email?: string }
): Promise<AuthResolveResult> {
  const authUid = sessionUser.id;
  const email = sessionUser.email;
  if (!authUid || !email) {
    return { ok: false, code: 'no_session', message: 'Your session is incomplete. Please sign in again.' };
  }

  // 1. Authoritative role from profiles (keyed by auth.uid()).
  const profileRes = await client
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', authUid)
    .limit(1);
  if (profileRes.error) {
    return { ok: false, code: 'no_profile', message: 'Could not load your account profile.' };
  }
  const profile = (profileRes.data as Array<Record<string, unknown>> | null)?.[0];
  if (!profile) {
    return {
      ok: false,
      code: 'no_profile',
      message: 'This account is not provisioned yet. Ask your shop owner to complete setup.',
    };
  }

  // 2. An ACTIVE tenant membership is required — a signed-in identity with no
  //    shop has nowhere to open and must not reach protected data.
  const membershipRes = await client
    .from('tenant_memberships')
    .select('tenant_id')
    .eq('user_id', authUid)
    .eq('is_active', true)
    .limit(1);
  if (membershipRes.error) {
    return { ok: false, code: 'no_membership', message: 'Could not load your shop membership.' };
  }
  const membership = (membershipRes.data as Array<Record<string, unknown>> | null)?.[0];
  if (!membership) {
    return {
      ok: false,
      code: 'no_membership',
      message: 'This account is not linked to an active shop. Contact your administrator.',
    };
  }

  // 3. The app roster row, matched by the Auth-verified email. RLS scopes this
  //    read to the caller's own tenant, so a foreign roster row is not visible.
  const rosterRes = await client
    .from('users')
    .select(REMOTE_USER_COLUMNS)
    .eq('email', email)
    .limit(1);
  if (rosterRes.error) {
    return { ok: false, code: 'no_roster', message: 'Could not load your staff record.' };
  }
  const roster = (rosterRes.data as Array<Record<string, unknown>> | null)?.[0];
  if (!roster) {
    return {
      ok: false,
      code: 'no_roster',
      message: 'No staff record exists for this account yet. Ask your shop owner to invite you.',
    };
  }
  if (roster.is_active === false) {
    return {
      ok: false,
      code: 'inactive',
      message: 'This account has been deactivated. Please contact your administrator.',
    };
  }

  const user: UserAccount = {
    ...(roster as unknown as UserAccount),
    // The profile role wins over the roster role: it is the field the RLS
    // helpers and the DB escalation trigger both trust. This keeps the app's
    // displayed role identical to the role the database enforces.
    role: (profile.role as UserRole) ?? (roster.role as UserRole),
  };
  return { ok: true, user };
}

/**
 * Sign out of Supabase Auth. Failures are swallowed: a network error during
 * sign-out must never strand the user in a half-logged-out state locally. The
 * caller always clears the local session too.
 */
export async function signOutSupabase(client: SupabaseAuthClient): Promise<void> {
  try {
    await client.auth.signOut();
  } catch {
    // Intentionally ignored — see above.
  }
}

/**
 * Read the current Supabase Auth session, if any. Used at startup to decide
 * whether an online session still exists (distinct from the offline-capable
 * locally persisted user, which the DatabaseService owns).
 */
export async function getCurrentAuthSession(
  client: SupabaseAuthClient
): Promise<{ user?: { id: string; email?: string } } | null> {
  try {
    const { data } = await client.auth.getSession();
    const session = data?.session as { user?: { id: string; email?: string } } | null | undefined;
    return session ?? null;
  } catch {
    return null;
  }
}

/** Narrow structural type re-exported so callers need not import supabase-js. */
export type { SupabaseClient };
