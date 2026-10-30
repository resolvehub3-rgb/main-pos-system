import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  REMOTE_USER_COLUMNS,
  classifySignInError,
  ensureOwnerShop,
  formatProvisionError,
  provisionStaffWithSupabase,
  resolveAuthUser,
  signInWithSupabase,
  signOutSupabase,
  signUpAndProvisionShop,
  type SupabaseAuthClient,
} from './authProvider.ts';

/**
 * Supabase Auth regression tests (Phase 2).
 *
 * These run against a hand-written STUB client — no network, no Vite env, no
 * real Supabase project — so they lock in the online auth LOGIC that can be
 * verified locally. Anything that needs a real Auth server (actual password
 * hashing, JWT verification, RLS enforcement, email delivery) is called out in
 * the report as STAGING-REQUIRED and is deliberately NOT claimed to pass here.
 *
 * What these prove without a backend:
 *  - sign-in failures are classified and never leak raw server text;
 *  - the application user is resolved from server-side profiles/memberships,
 *    with the authoritative role taken from `profiles.role` (never the client);
 *  - missing profile / missing active membership / deactivated roster rows are
 *    REFUSED, not silently granted access;
 *  - the roster read uses an explicit column list that excludes password/pin;
 *  - new-shop provisioning calls the trusted SECURITY DEFINER RPC and never
 *    asks for (or can supply) a super_admin role;
 *  - email-confirmation-required sign-ups do NOT run the RPC and report back;
 *  - sign-out swallows network errors so the user is never stranded.
 */

interface StubCalls {
  signIn: Array<{ email: string; password: string }>;
  signUp: Array<Record<string, unknown>>;
  rpc: Array<{ fn: string; params?: Record<string, unknown> }>;
  signOut: number;
  selects: Array<{ table: string; columns: string }>;
}

interface StubOverrides {
  signIn?: (p: { email: string; password: string }) => { data: unknown; error: { message: string } | null };
  signUp?: (p: Record<string, unknown>) => { data: unknown; error: { message: string } | null };
  signOut?: () => { error: { message: string } | null } | never;
  rpc?: (fn: string, params?: Record<string, unknown>) => { data: unknown; error: { message: string } | null };
  rows?: (state: { table: string; columns: string; filters: Array<[string, unknown]> }) => {
    data: unknown;
    error: { message: string } | null;
  };
}

function makeStub(overrides: StubOverrides = {}): { client: SupabaseAuthClient; calls: StubCalls } {
  const calls: StubCalls = { signIn: [], signUp: [], rpc: [], signOut: 0, selects: [] };

  const makeQueryBuilder = (table: string) => {
    const state = { table, columns: '', filters: [] as Array<[string, unknown]> };
    const resolve = () =>
      Promise.resolve(overrides.rows ? overrides.rows(state) : { data: [], error: null });
    const builder = {
      select(columns: string) {
        state.columns = columns;
        calls.selects.push({ table, columns });
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push([column, value]);
        return builder;
      },
      ilike() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return resolve();
      },
      then(onFulfilled: any, onRejected: any) {
        return resolve().then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  const client: SupabaseAuthClient = {
    auth: {
      signInWithPassword: (params) => {
        calls.signIn.push(params);
        return Promise.resolve(
          (overrides.signIn?.(params) ?? { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } }) as any,
        );
      },
      signOut: () => {
        calls.signOut += 1;
        return Promise.resolve(overrides.signOut?.() ?? { error: null });
      },
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      signUp: (params) => {
        calls.signUp.push(params);
        return Promise.resolve(
          (overrides.signUp?.(params) ?? { data: { user: null, session: null }, error: null }) as any,
        );
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table: string) => makeQueryBuilder(table),
    rpc: (fn: string, params?: Record<string, unknown>) => {
      calls.rpc.push({ fn, params });
      return Promise.resolve(overrides.rpc?.(fn, params) ?? { data: null, error: null });
    },
  };

  return { client, calls };
}

/* -------------------------------------------------------------------------- */
/* Error classification                                                        */
/* -------------------------------------------------------------------------- */

test('classifySignInError maps invalid credentials without leaking server text', () => {
  const msg = classifySignInError('Invalid login credentials');
  assert.match(msg, /incorrect email or password/i);
  assert.doesNotMatch(msg, /gotrue|jwt|sql/i, 'must not leak internals');
});

test('classifySignInError asks the user to confirm an unconfirmed email', () => {
  assert.match(classifySignInError('Email not confirmed'), /confirm your email/i);
});

test('classifySignInError surfaces rate limiting', () => {
  assert.match(classifySignInError('rate limit exceeded'), /too many/i);
});

test('classifySignInError reports a network outage as reachability, not bad credentials', () => {
  assert.match(classifySignInError('Failed to fetch'), /could not reach/i);
});

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                     */
/* -------------------------------------------------------------------------- */

test('signInWithSupabase returns the session user on success', async () => {
  const { client } = makeStub({
    signIn: () => ({
      data: { user: { id: 'uid-1', email: 'a@b.com', user_metadata: { shop_name: 'X' } }, session: {} },
      error: null,
    }),
  });
  const res = await signInWithSupabase(client, 'a@b.com', 'pw');
  assert.equal(res.ok, true);
  assert.equal((res as any).user.id, 'uid-1');
  assert.equal((res as any).user.user_metadata.shop_name, 'X');
});

test('signInWithSupabase classifies a failed credential check', async () => {
  const { client } = makeStub({
    signIn: () => ({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } }),
  });
  const res = await signInWithSupabase(client, 'a@b.com', 'wrong');
  assert.equal(res.ok, false);
  assert.match((res as any).message, /incorrect email or password/i);
});

test('signInWithSupabase refuses a success response that carries no user', async () => {
  const { client } = makeStub({
    signIn: () => ({ data: { user: null, session: {} }, error: null }),
  });
  const res = await signInWithSupabase(client, 'a@b.com', 'pw');
  assert.equal(res.ok, false);
});

/* -------------------------------------------------------------------------- */
/* Resolving the application user from auth.uid()                              */
/* -------------------------------------------------------------------------- */

const uid = 'auth-uid-0001';

function happyRows(overrides?: { profileRole?: string; rosterRole?: string; rosterActive?: boolean }) {
  return (state: { table: string; filters: Array<[string, unknown]> }) => {
    if (state.table === 'profiles') {
      return { data: [{ id: uid, role: overrides?.profileRole ?? 'shop_owner', full_name: 'Kojo', email: 'a@b.com', phone: '024' }], error: null };
    }
    if (state.table === 'tenant_memberships') {
      return { data: [{ tenant_id: 'tenant-uuid-1' }], error: null };
    }
    if (state.table === 'users') {
      return {
        data: [{
          id: 'roster-1',
          tenant_id: 'tenant-uuid-1',
          shop_name: 'Antwi Mart',
          full_name: 'Kojo',
          email: 'a@b.com',
          phone: '024',
          role: overrides?.rosterRole ?? 'shop_owner',
          is_active: overrides?.rosterActive ?? true,
          created_at: '2026-01-01T00:00:00.000Z',
        }],
        error: null,
      };
    }
    return { data: [], error: null };
  };
}

test('resolveAuthUser builds the user from profiles + memberships + roster', async () => {
  const { client } = makeStub({ rows: happyRows() });
  const res = await resolveAuthUser(client, { id: uid, email: 'a@b.com' });
  assert.equal(res.ok, true);
  const user = (res as any).user;
  assert.equal(user.tenant_id, 'tenant-uuid-1');
  assert.equal(user.shop_name, 'Antwi Mart');
  assert.equal(user.role, 'shop_owner');
});

test('the authoritative role comes from profiles, never the roster row', async () => {
  // Roster says cashier, profile says shop_owner. The DB-protected profile role
  // must win so the app shows exactly the role the database enforces.
  const { client } = makeStub({ rows: happyRows({ profileRole: 'shop_owner', rosterRole: 'cashier' }) });
  const res = await resolveAuthUser(client, { id: uid, email: 'a@b.com' });
  assert.equal((res as any).user.role, 'shop_owner');
});

test('resolveAuthUser refuses an identity with no profile', async () => {
  const { client } = makeStub({
    rows: (state) => (state.table === 'profiles' ? { data: [], error: null } : { data: [], error: null }),
  });
  const res = await resolveAuthUser(client, { id: uid, email: 'a@b.com' });
  assert.equal(res.ok, false);
  assert.equal((res as any).code, 'no_profile');
});

test('resolveAuthUser refuses a signed-in identity with no active membership', async () => {
  const { client } = makeStub({
    rows: (state) => {
      if (state.table === 'profiles') return { data: [{ id: uid, role: 'cashier', full_name: 'X', email: 'a@b.com', phone: '' }], error: null };
      return { data: [], error: null }; // no membership, no roster
    },
  });
  const res = await resolveAuthUser(client, { id: uid, email: 'a@b.com' });
  assert.equal(res.ok, false);
  assert.equal((res as any).code, 'no_membership');
});

test('a super admin signs in with no shop, membership or roster row', async () => {
  // A super admin is a PLATFORM account: they own no shop, so the membership
  // and roster steps that every other role must pass would lock them out. The
  // DB-protected profiles.role alone is enough — the escalation trigger already
  // guarantees it could not have been written by a non-super-admin.
  const { client, calls } = makeStub({
    rows: (state) => {
      if (state.table === 'profiles') {
        return {
          data: [{ id: uid, role: 'super_admin', full_name: 'Sam Pos', email: 'sampos@gmail.com', phone: '', created_at: '2026-10-20T09:15:00.000Z' }],
          error: null,
        };
      }
      return { data: [], error: null }; // no membership, no roster — as expected
    },
  });
  const res = await resolveAuthUser(client, { id: uid, email: 'sampos@gmail.com' });
  assert.equal(res.ok, true);
  const user = (res as any).user;
  assert.equal(user.role, 'super_admin');
  assert.equal(user.id, uid);
  // No tenant: the platform dashboard pulls every shop, not one.
  assert.equal(user.tenant_id, undefined);
  // The membership/roster reads are skipped entirely for a super admin.
  const tablesRead = calls.selects.map((s) => s.table);
  assert.ok(!tablesRead.includes('tenant_memberships'), 'must not require a membership');
  assert.ok(!tablesRead.includes('users'), 'must not require a roster row');
});

test('resolveAuthUser signs in a provisioned owner with profile + membership but NO roster row', async () => {
  // The create_tenant_with_owner RPC writes a profile + an active membership
  // but deliberately NOT a public.users roster row (that table is the
  // app-managed staff list, written when an owner invites staff). Requiring a
  // roster row locked every freshly-registered owner out with "no staff
  // record". The profile + active membership are sufficient: profile.role is
  // escalation-trigger-protected, and the membership (already filtered to
  // is_active) is the live proof of an active shop.
  const { client } = makeStub({
    rows: (state) => {
      if (state.table === 'profiles') {
        return { data: [{ id: uid, role: 'shop_owner', full_name: 'Zen Owner', email: 'a@b.com', phone: '024', created_at: '2026-10-29T10:00:00.000Z' }], error: null };
      }
      if (state.table === 'tenant_memberships') return { data: [{ tenant_id: 't1' }], error: null };
      if (state.table === 'tenants') return { data: [{ name: 'Zen Mart Shop' }], error: null };
      return { data: [], error: null }; // users roster empty
    },
  });
  const res = await resolveAuthUser(client, { id: uid, email: 'a@b.com' });
  assert.equal(res.ok, true, 'profile + active membership must be enough to sign in');
  const user = (res as any).user;
  assert.equal(user.id, uid);
  assert.equal(user.tenant_id, 't1');
  assert.equal(user.shop_name, 'Zen Mart Shop', 'shop name comes from the tenants row');
  assert.equal(user.role, 'shop_owner', 'role comes from the DB-protected profile');
  assert.equal(user.is_active, true);
});

test('resolveAuthUser still fails with no_roster when the roster READ itself errors', async () => {
  // The roster row is optional, but the query must not silently swallow a
  // real read failure (network/permission) as "no roster row".
  const { client } = makeStub({
    rows: (state) => {
      if (state.table === 'profiles') return { data: [{ id: uid, role: 'cashier', full_name: 'X', email: 'a@b.com', phone: '' }], error: null };
      if (state.table === 'tenant_memberships') return { data: [{ tenant_id: 't1' }], error: null };
      if (state.table === 'users') return { data: null, error: { message: 'permission denied' } };
      return { data: [], error: null };
    },
  });
  const res = await resolveAuthUser(client, { id: uid, email: 'a@b.com' });
  assert.equal(res.ok, false);
  assert.equal((res as any).code, 'no_roster');
});

test('resolveAuthUser refuses a deactivated roster row', async () => {
  const { client } = makeStub({ rows: happyRows({ rosterActive: false }) });
  const res = await resolveAuthUser(client, { id: uid, email: 'a@b.com' });
  assert.equal(res.ok, false);
  assert.equal((res as any).code, 'inactive');
  assert.match((res as any).message, /deactivated/i);
});

test('resolveAuthUser refuses an incomplete session (no email)', async () => {
  const { client } = makeStub();
  const res = await resolveAuthUser(client, { id: uid });
  assert.equal(res.ok, false);
  assert.equal((res as any).code, 'no_session');
});

test('the roster read selects an explicit column list that excludes credentials', async () => {
  const { client, calls } = makeStub({ rows: happyRows() });
  await resolveAuthUser(client, { id: uid, email: 'a@b.com' });
  const rosterSelect = calls.selects.find((s) => s.table === 'users');
  assert.ok(rosterSelect, 'the users table must be read');
  assert.doesNotMatch(rosterSelect!.columns, /password|pin/i, 'credentials must never be selected');
  assert.equal(rosterSelect!.columns, REMOTE_USER_COLUMNS);
});

/* -------------------------------------------------------------------------- */
/* Trusted provisioning                                                        */
/* -------------------------------------------------------------------------- */

test('signUpAndProvisionShop calls the SECURITY DEFINER RPC with the shop details', async () => {
  const { client, calls } = makeStub({
    signUp: () => ({ data: { user: { id: uid, email: 'a@b.com' }, session: {} }, error: null }),
    rpc: () => ({ data: 'tenant-uuid-9', error: null }),
  });
  const res = await signUpAndProvisionShop(client, {
    email: 'a@b.com',
    password: 'pw',
    shopName: 'Antwi Mart',
    shopAddress: 'Osu',
    fullName: 'Kojo Antwi',
    phone: '024',
  });
  assert.equal(res.ok, true);
  assert.equal((res as any).tenantId, 'tenant-uuid-9');

  const rpcCall = calls.rpc.find((r) => r.fn === 'create_tenant_with_owner');
  assert.ok(rpcCall, 'provisioning must go through the trusted RPC');
  assert.equal(rpcCall!.params!.p_shop_name, 'Antwi Mart');
  // The RPC is asked only for shop details — never for a role, so a tampered
  // client cannot request super_admin (or any role) through this path.
  assert.equal('p_role' in rpcCall!.params!, false);
  assert.equal('role' in rpcCall!.params!, false);
});

test('signUpAndProvisionShop does NOT run the RPC when email confirmation is pending', async () => {
  const { client, calls } = makeStub({
    signUp: () => ({ data: { user: { id: uid, email: 'a@b.com' }, session: null }, error: null }),
  });
  const res = await signUpAndProvisionShop(client, {
    email: 'a@b.com',
    password: 'pw',
    shopName: 'Antwi Mart',
    fullName: 'Kojo',
    phone: '024',
  });
  assert.equal(res.ok, false);
  assert.equal((res as any).needsEmailConfirmation, true);
  assert.equal(calls.rpc.length, 0, 'no auth.uid() means the RPC must not be attempted');
});

test('signUpAndProvisionShop surfaces a provisioning failure', async () => {
  const { client } = makeStub({
    signUp: () => ({ data: { user: { id: uid, email: 'a@b.com' }, session: {} }, error: null }),
    rpc: () => ({ data: null, error: { message: 'permission denied for table tenants' } }),
  });
  const res = await signUpAndProvisionShop(client, {
    email: 'a@b.com',
    password: 'pw',
    shopName: 'Antwi Mart',
    fullName: 'Kojo',
    phone: '024',
  });
  assert.equal(res.ok, false);
  assert.match((res as any).message, /could not create your shop/i);
});

test('a missing provisioning migration is reported as the fix, not PostgREST jargon', async () => {
  // The real production failure: the RPC's migration was never applied to the
  // project, and PostgREST answered PGRST202 with internal signature text.
  // The owner must be told to apply the migrations — not shown schema cache
  // internals they cannot act on.
  const { client } = makeStub({
    signUp: () => ({ data: { user: { id: uid, email: 'a@b.com' }, session: {} }, error: null }),
    rpc: () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message:
          'Could not find the function public.create_tenant_with_owner(p_owner_name, p_owner_phone, p_shop_address, p_shop_name) in the schema cache',
      },
    }),
  });
  const res = await signUpAndProvisionShop(client, {
    email: 'a@b.com',
    password: 'pw',
    shopName: 'Antwi Mart',
    fullName: 'Kojo',
    phone: '024',
  });
  assert.equal(res.ok, false);
  const message = (res as any).message as string;
  assert.match(message, /pending migrations/i);
  assert.match(message, /20261030000001_provisioning_rpc\.sql/);
  assert.ok(!message.includes('schema cache'), 'the raw PostgREST text must not leak through');

  // The post-confirmation path gives the same guidance.
  const again = formatProvisionError('Could not set up your shop', {
    code: 'PGRST202',
    message: 'Could not find the function public.create_tenant_with_owner without parameters',
  });
  assert.match(again, /pending migrations/i);
});

test('staff provisioning uses the trusted function and returns its Auth UUID', async () => {
  let invocation: { name: string; body: Record<string, string> } | undefined;
  const result = await provisionStaffWithSupabase(
    {
      functions: {
        invoke: async (name, options) => {
          invocation = { name, body: options.body };
          return { data: { user_id: uid }, error: null };
        },
      },
    },
    {
      tenantId: 'tenant-uuid',
      fullName: 'Kojo Antwi',
      email: 'kojo@example.com',
      phone: '024',
      password: 'secure-password',
      role: 'cashier',
    },
  );

  assert.deepEqual(result, { ok: true, userId: uid });
  assert.equal(invocation?.name, 'provision-staff');
  assert.deepEqual(invocation?.body, {
    tenant_id: 'tenant-uuid',
    full_name: 'Kojo Antwi',
    email: 'kojo@example.com',
    phone: '024',
    password: 'secure-password',
    role: 'cashier',
  });
});

test('staff provisioning surfaces backend failure without reporting success', async () => {
  const result = await provisionStaffWithSupabase(
    {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: new Response(JSON.stringify({ message: 'Only this shop’s owner can add staff.' })),
          },
        }),
      },
    },
    {
      tenantId: 'tenant-uuid',
      fullName: 'Kojo Antwi',
      email: 'kojo@example.com',
      phone: '',
      password: 'secure-password',
      role: 'cashier',
    },
  );

  assert.deepEqual(result, { ok: false, message: 'Only this shop’s owner can add staff.' });
});

test('staff provisioning translates the unreachable-Edge-Function text into the deploy fix', async () => {
  const result = await provisionStaffWithSupabase(
    {
      functions: {
        invoke: async () => ({
          data: null,
          error: { message: 'Failed to send a request to the Edge Function' },
        }),
      },
    },
    {
      tenantId: 'tenant-uuid',
      fullName: 'Kojo Antwi',
      email: 'kojo@example.com',
      phone: '',
      password: 'secure-password',
      role: 'cashier',
    },
  );

  assert.equal(result.ok, false);
  const message = (result as any).message as string;
  assert.match(message, /provision-staff/);
  assert.match(message, /supabase functions deploy/);
  assert.ok(
    !message.includes('Failed to send a request to the Edge Function'),
    'the raw SDK text must not leak to the shop owner',
  );
});

test('staff provisioning names the missing Edge Function when the gateway answers 404', async () => {
  const result = await provisionStaffWithSupabase(
    {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: new Response(
              JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } },
            ),
          },
        }),
      },
    },
    {
      tenantId: 'tenant-uuid',
      fullName: 'Kojo Antwi',
      email: 'kojo@example.com',
      phone: '',
      password: 'secure-password',
      role: 'cashier',
    },
  );

  assert.equal(result.ok, false);
  const message = (result as any).message as string;
  assert.match(message, /supabase functions deploy provision-staff/);
  assert.ok(
    !message.includes('Requested function was not found'),
    'the gateway text must not leak to the shop owner',
  );
});

test('staff provisioning turns a gateway token rejection into a sign-in prompt', async () => {
  const result = await provisionStaffWithSupabase(
    {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: new Response(
              JSON.stringify({ code: 'UNAUTHORIZED_NO_AUTH_HEADER', message: 'Missing authorization header' }),
              { status: 401, headers: { 'Content-Type': 'application/json' } },
            ),
          },
        }),
      },
    },
    {
      tenantId: 'tenant-uuid',
      fullName: 'Kojo Antwi',
      email: 'kojo@example.com',
      phone: '',
      password: 'secure-password',
      role: 'cashier',
    },
  );

  assert.equal(result.ok, false);
  const message = (result as any).message as string;
  assert.match(message, /sign-in has expired/i);
  assert.ok(!message.includes('authorization header'), 'gateway internals must not leak');
});

test('signUpAndProvisionShop classifies a duplicate-email sign-up', async () => {
  const { client } = makeStub({
    signUp: () => ({ data: { user: null, session: null }, error: { message: 'A user with this email address has already been registered' } }),
  });
  const res = await signUpAndProvisionShop(client, {
    email: 'a@b.com',
    password: 'pw',
    shopName: 'Antwi Mart',
    fullName: 'Kojo',
    phone: '024',
  });
  assert.equal(res.ok, false);
  assert.ok((res as any).message, 'a user-facing message must be returned');
});

test('ensureOwnerShop provisions through the same idempotent RPC', async () => {
  const { client, calls } = makeStub({ rpc: () => ({ data: 'tenant-uuid-2', error: null }) });
  const res = await ensureOwnerShop(client, { shopName: 'Antwi Mart', fullName: 'Kojo', phone: '024' });
  assert.equal(res.ok, true);
  assert.equal((res as any).tenantId, 'tenant-uuid-2');
  assert.equal(calls.rpc[0].fn, 'create_tenant_with_owner');
});

/* -------------------------------------------------------------------------- */
/* Sign-out                                                                    */
/* -------------------------------------------------------------------------- */

test('signOutSupabase swallows a network failure so the user is never stranded', async () => {
  const { client, calls } = makeStub({
    signOut: () => {
      throw new TypeError('Failed to fetch');
    },
  });
  // Must not reject: a failed online sign-out still clears the local session.
  await signOutSupabase(client);
  assert.equal(calls.signOut, 1, 'the sign-out was still attempted');
});
