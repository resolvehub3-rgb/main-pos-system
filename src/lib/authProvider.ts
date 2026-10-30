import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserAccount, UserRole } from '../types/index.ts';
import { attemptsLeftMessage, lockoutMessage, PIN_LOCKOUT_MS } from './pinAuth.ts';

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
const PROFILE_COLUMNS = 'id,role,full_name,email,phone,created_at';

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

/* -------------------------------------------------------------------------- */
/* Cashier PIN verification (server-side)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Outcome of `verify_cashier_pin`, the RPC run by the sign-in screen.
 *
 * `'no_pin'` / `'no_user'` are not failures: they mean the backend has no PIN
 * hash for this cashier yet (created offline, write still queued), so the
 * caller falls back to the salted hash the till already holds — that fallback
 * is the offline half of "backend + offline fallback" and it verifies the same
 * PIN the owner assigned.
 *
 * `'unavailable'` covers a network outage and a database that has not had the
 * PIN migration applied yet; it too falls back to the device hash rather than
 * locking cashiers out of their own till.
 */
export type CashierPinVerifyResult =
  | { status: 'ok'; user: UserAccount }
  | { status: 'invalid'; attemptsLeft: number; message: string }
  | { status: 'locked'; retryAfterMs: number; message: string }
  | { status: 'inactive'; message: string }
  | { status: 'no_pin' | 'no_user' }
  | { status: 'unavailable'; message: string };

/** Build the application user the verifier hands back on a correct PIN. */
function pinUserFromPayload(payload: Record<string, unknown>): UserAccount | null {
  const id = payload.id;
  if (typeof id !== 'string' || !id) return null;
  return {
    id,
    tenant_id: typeof payload.tenant_id === 'string' ? payload.tenant_id : undefined,
    shop_name: typeof payload.shop_name === 'string' ? payload.shop_name : undefined,
    full_name: typeof payload.full_name === 'string' ? payload.full_name : '',
    email: typeof payload.email === 'string' ? payload.email : '',
    phone: typeof payload.phone === 'string' ? payload.phone : '',
    // The verifier only ever returns a cashier (SQL enforces role = 'cashier');
    // the default keeps an unexpected payload from minting a privileged role.
    role: payload.role === 'shop_owner' || payload.role === 'super_admin' ? payload.role : 'cashier',
    is_active: payload.is_active !== false,
    created_at:
      typeof payload.created_at === 'string' ? payload.created_at : new Date().toISOString(),
  };
}

/**
 * Verify a cashier's PIN against the backend (`public.cashier_pins`, bcrypt).
 *
 * Returns a status word instead of throwing: the caller decides between
 * opening the session, counting the attempt, honouring the lockout, and the
 * offline fallback. The hash itself is never returned to the client.
 */
export async function verifyCashierPinWithSupabase(
  client: SupabaseAuthClient,
  params: { tenantId: string; userId: string; pin: string }
): Promise<CashierPinVerifyResult> {
  let payload: unknown;
  let error: { message: string } | null = null;
  try {
    ({ data: payload, error } = await client.rpc('verify_cashier_pin', {
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_pin: params.pin,
    }));
  } catch (err) {
    // fetch rejection (offline) — the till falls back to its local hash.
    return { status: 'unavailable', message: err instanceof Error ? err.message : String(err) };
  }
  if (error) {
    return { status: 'unavailable', message: error.message };
  }

  const data = (payload ?? {}) as Record<string, unknown>;
  switch (data.status) {
    case 'ok': {
      const user = pinUserFromPayload(data);
      return user ? { status: 'ok', user } : { status: 'unavailable', message: 'Verifier returned no user.' };
    }
    case 'invalid': {
      const attemptsLeft = typeof data.attempts_left === 'number' ? data.attempts_left : 0;
      return { status: 'invalid', attemptsLeft, message: attemptsLeftMessage(attemptsLeft) };
    }
    case 'locked': {
      const retryAfterMs =
        typeof data.retry_after === 'number' ? Math.max(0, data.retry_after) * 1000 : PIN_LOCKOUT_MS;
      return { status: 'locked', retryAfterMs, message: lockoutMessage(retryAfterMs) };
    }
    case 'inactive':
      return {
        status: 'inactive',
        message: 'This cashier account has been deactivated. Please contact your shop owner.',
      };
    case 'no_pin':
    case 'no_user':
      return { status: data.status };
    default:
      return { status: 'unavailable', message: 'Verifier returned an unexpected response.' };
  }
}

/** Result of `set_cashier_pin`; `retryLater` marks "queue and try again". */
export type CashierPinSetResult =
  | { ok: true }
  | { ok: false; message: string; retryLater?: boolean };

/**
 * Ask the backend to store (or reset) a cashier's bcrypt PIN hash.
 *
 * Called by the owner while managing staff. A `retryLater` failure means the
 * database could not take the write right now (offline, migration pending, or
 * the cashier's roster row has not synced) — the caller keeps the device-local
 * hash and queues this call so the backend catches up instead of rejecting the
 * new PIN later.
 */
export async function setCashierPinWithSupabase(
  client: SupabaseAuthClient,
  params: { tenantId: string; userId: string; pin: string }
): Promise<CashierPinSetResult> {
  let payload: unknown;
  let error: { message: string } | null = null;
  try {
    ({ data: payload, error } = await client.rpc('set_cashier_pin', {
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_pin: params.pin,
    }));
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      retryLater: true,
    };
  }
  if (error) return { ok: false, message: error.message, retryLater: true };

  const status = (payload as { status?: string } | null)?.status;
  switch (status) {
    case 'ok':
      return { ok: true };
    case 'no_user':
      return {
        ok: false,
        message: 'This cashier has not synced to the shop database yet.',
        retryLater: true,
      };
    case 'forbidden':
      return { ok: false, message: 'Only this shop’s owner can assign a cashier PIN.' };
    case 'not_cashier':
      return { ok: false, message: 'A sign-in PIN applies to cashier accounts only.' };
    case 'invalid_pin':
      return { ok: false, message: 'PIN must be 4 to 6 digits.' };
    default:
      return {
        ok: false,
        message: 'The shop database returned an unexpected response.',
        retryLater: true,
      };
  }
}

export interface StaffProvisionClient {
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, string> }
    ): PromiseLike<{
      data: unknown;
      error: { message: string; context?: unknown } | null;
    }>;
  };
}

export type StaffProvisionResult =
  | { ok: true; userId: string }
  | { ok: false; message: string };

/**
 * The SDK text for a request that never produced an HTTP response.
 *
 * `FunctionsFetchError` means `fetch` itself rejected: no connection, a
 * blocked request, or a CORS preflight the browser refused. That last one is
 * what an undeployed function looks like from the browser — the gateway's
 * fallback 404 does not include `content-type` in `Access-Control-Allow-
 * Headers`, so the preflight for our JSON POST fails and `fetch` rejects
 * instead of ever handing back the 404.
 */
const FUNCTIONS_FETCH_ERROR = 'Failed to send a request to the Edge Function';

/** Shown when the gateway answers 404 because the function was never deployed. */
const STAFF_FUNCTION_NOT_DEPLOYED_MESSAGE =
  'Could not create the staff login: the staff provisioning service is not deployed ' +
  'for this Supabase project. From the repository root run ' +
  '`supabase functions deploy provision-staff`, then retry.';

/** Shown when the request never reached the Edge Function at all. */
const STAFF_FUNCTION_UNREACHABLE_MESSAGE =
  'Could not create the staff login: the provisioning service could not be reached. ' +
  'Check your connection and retry. If it keeps failing, the `provision-staff` Edge ' +
  'Function is not deployed for this Supabase project — run ' +
  '`supabase functions deploy provision-staff`, then retry.';

/** Shown when the gateway refuses the token before the function even runs. */
const STAFF_SESSION_EXPIRED_MESSAGE =
  'Could not create the staff login: your sign-in has expired. Sign in again and retry.';

/**
 * Turn a `functions.invoke` failure into the message shown to the owner.
 *
 * Mirrors `formatProvisionError`: raw transport text ("Failed to send a
 * request to the Edge Function", "Requested function was not found",
 * "Invalid JWT") names an SDK or gateway internal and tells the operator
 * nothing about the fix, so the three conditions that made staff creation look
 * broken are translated into the action that repairs them. Everything else
 * passes through unchanged — the function's own messages ("Only this shop's
 * owner can add staff.") are already written for the reader.
 */
export async function formatStaffProvisionError(
  error: { message: string; context?: unknown }
): Promise<string> {
  const context = error.context;
  if (context instanceof Response) {
    try {
      const body: unknown = await context.clone().json();
      if (
        typeof body === 'object' &&
        body !== null &&
        'message' in body &&
        typeof body.message === 'string'
      ) {
        const message = body.message;
        const code = 'code' in body ? (body as { code?: unknown }).code : undefined;
        const notDeployed =
          code === 'NOT_FOUND' ||
          /(?:requested )?function (?:was )?not found|cannot find function/i.test(message);
        if (notDeployed) return STAFF_FUNCTION_NOT_DEPLOYED_MESSAGE;
        // With `verify_jwt` on, the gateway rejects an absent or malformed
        // token before the function runs, so those `UNAUTHORIZED_*` codes are
        // the one auth failure the function's own 401s never cover.
        if (typeof code === 'string' && code.startsWith('UNAUTHORIZED')) {
          return STAFF_SESSION_EXPIRED_MESSAGE;
        }
        return message;
      }
    } catch {
      // A non-JSON response falls back to the SDK's explicit error message.
    }
  }
  if (error.message.includes(FUNCTIONS_FETCH_ERROR)) return STAFF_FUNCTION_UNREACHABLE_MESSAGE;
  return `Could not create the staff login: ${error.message}`;
}

/**
 * Provision a login through the trusted server-side Admin API function.
 *
 * A browser client cannot create Supabase Auth users with the shop owner's
 * session. The function verifies the owner, creates the Auth identity, then
 * links its UUID to the shop roster and membership before returning success.
 */
export async function provisionStaffWithSupabase(
  client: StaffProvisionClient,
  params: {
    tenantId: string;
    fullName: string;
    email: string;
    phone: string;
    password: string;
    role: 'cashier' | 'shop_owner';
  }
): Promise<StaffProvisionResult> {
  let data: unknown;
  let error: { message: string; context?: unknown } | null = null;
  try {
    ({ data, error } = await client.functions.invoke('provision-staff', {
      body: {
        tenant_id: params.tenantId,
        full_name: params.fullName,
        email: params.email,
        phone: params.phone,
        password: params.password,
        role: params.role,
      },
    }));
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error
        ? `Could not reach the staff provisioning service: ${err.message}`
        : 'Could not reach the staff provisioning service. Check your connection and try again.',
    };
  }

  if (error) {
    return { ok: false, message: await formatStaffProvisionError(error) };
  }

  const userId =
    typeof data === 'object' &&
    data !== null &&
    'user_id' in data &&
    typeof data.user_id === 'string'
      ? data.user_id
      : '';
  if (!userId) {
    return {
      ok: false,
      message: 'The staff provisioning service returned no account ID. The cashier was not added.',
    };
  }
  return { ok: true, userId };
}

/** Result of the trusted online new-shop provisioning flow. */
export type ProvisionResult =
  | { ok: true; authUser: { id: string; email?: string }; tenantId: string }
  | { ok: false; message: string; needsEmailConfirmation?: boolean };

/**
 * Turn a provisioning RPC error into the message shown to the owner.
 *
 * PostgREST answers PGRST202 ("could not find the function … in the schema
 * cache") when the function exists in the repo but its migration was never
 * applied to the project — the exact failure that kept shop registration
 * broken while every code path was correct. The raw text names internal
 * signatures and helps no one; this spells out the actual fix instead.
 * Everything else passes through, prefixed the same way as before.
 */
export function formatProvisionError(
  prefix: string,
  error: { message: string; code?: string }
): string {
  if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) {
    return (
      `${prefix}: the database is missing the shop-provisioning setup. ` +
      'Ask your administrator to apply the pending migrations in supabase/migrations ' +
      '(in filename order, in the Supabase SQL Editor) — starting with ' +
      '20261030000001_provisioning_rpc.sql — then try again.'
    );
  }
  return `${prefix}: ${error.message}`;
}

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
    return { ok: false, message: formatProvisionError('Could not create your shop', rpcError) };
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
  if (error) return { ok: false, message: formatProvisionError('Could not set up your shop', error) };
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

  // A super admin is a PLATFORM account: they own no shop, so there is no
  // membership (step 2) and no per-shop roster row (step 3) to find — and the
  // requirements below would lock every super admin out. Their authority is
  // the `profiles.role` row just read, which the database itself protects: the
  // `block_super_admin_escalation` trigger (migration 20261029000001) refuses
  // `role='super_admin'` from any authenticated caller who is not already one,
  // so this value is written only by the trusted service role / SQL Editor.
  // Reaching it here therefore means the database has already vouched for the
  // role — no shop is required to prove it.
  if (profile.role === 'super_admin') {
    const superAdmin: UserAccount = {
      id: authUid,
      full_name: (profile.full_name as string) ?? email,
      email: (profile.email as string) ?? email,
      role: 'super_admin',
      phone: (profile.phone as string) ?? '',
      is_active: true,
      created_at: (profile.created_at as string) ?? new Date().toISOString(),
    };
    return { ok: true, user: superAdmin };
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
  //
  //    OPTIONAL for an account the trusted RPC just provisioned. The
  //    create_tenant_with_owner RPC writes a profile + an active membership
  //    but deliberately NOT a public.users roster row (that table is the
  //    app-managed staff list, written when an owner invites staff — not part
  //    of trusted shop signup). Requiring it here would lock out every
  //    newly-registered owner with "no staff record". So: if a roster row
  //    exists we use it as before; if it does not, we still have everything
  //    needed to sign the user in safely —
  //      • profile.role   → the authoritative, escalation-trigger-protected role;
  //      • membership     → proof of an ACTIVE shop (already filtered below),
  //                         which is also how deactivation is enforced.
  //    We build the user from those instead of refusing.
  const rosterRes = await client
    .from('users')
    .select(REMOTE_USER_COLUMNS)
    .eq('email', email)
    .limit(1);
  if (rosterRes.error) {
    return { ok: false, code: 'no_roster', message: 'Could not load your staff record.' };
  }
  const roster = (rosterRes.data as Array<Record<string, unknown>> | null)?.[0];

  if (roster) {
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

  // No roster row. The membership already proved an active shop, so this is a
  // trusted-provisioned account (e.g. a shop owner who just registered). Build
  // the user from the profile + membership. We fetch the shop's name so the
  // header and dashboard show the real shop, not a placeholder.
  const tenantId = String(membership.tenant_id);
  let shopName: string | undefined;
  const tenantRes = await client.from('tenants').select('name').eq('id', tenantId).limit(1);
  if (!tenantRes.error) {
    const tenant = (tenantRes.data as Array<Record<string, unknown>> | null)?.[0];
    shopName = typeof tenant?.name === 'string' ? tenant.name : undefined;
  }
  const user: UserAccount = {
    id: authUid,
    tenant_id: tenantId,
    shop_name: shopName,
    full_name: (profile.full_name as string) ?? email,
    email: (profile.email as string) ?? email,
    role: (profile.role as UserRole) ?? 'cashier',
    phone: (profile.phone as string) ?? '',
    // An active membership is the live gate (step 2 filters is_active), so a
    // provisioned account with no roster row is active by construction.
    is_active: true,
    created_at: (profile.created_at as string) ?? new Date().toISOString(),
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
