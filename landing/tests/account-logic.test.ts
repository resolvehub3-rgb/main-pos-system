/**
 * Customer account logic tests — validation, feature-gate availability,
 * hash routing and the registration/verification/sign-in/reset flows driven
 * through a fake AuthProvider (no network, no database, no real accounts).
 *
 * The fake provider exercises exactly the orchestration in
 * src/lib/authFlow.ts; the browser uses the supabase adapter on top of the
 * same interface.
 */

import {assert, assertEqual, test} from './harness.ts';
import {
  accountAvailability,
  downloadAvailability,
} from '../src/lib/availability.ts';
import {
  classifyAuthError,
  registerAccount,
  requestPasswordReset,
  resendConfirmation,
  setNewPassword,
  signInToAccount,
  verifyEmailAddress,
  type AuthProvider,
} from '../src/lib/authFlow.ts';
import {
  isAccountRoute,
  nextRouteAfterSignIn,
  parseRoute,
  verificationParams,
} from '../src/lib/hashRoute.ts';
import {
  validateEmail,
  validateFullName,
  validatePassword,
  validatePhone,
  validateRegistration,
} from '../src/lib/validation.ts';
import {COMMERCE} from '../src/config/commerce.ts';

// ---------------------------------------------------------------------------
// Fake provider helpers
// ---------------------------------------------------------------------------

function baseProvider(): {provider: AuthProvider; calls: string[]} {
  const calls: string[] = [];
  const provider: AuthProvider = {
    async signUp(input) {
      calls.push('signUp');
      return {
        user: {id: 'user-1', email: input.email},
        session: null,
        identities: [{id: 'identity-1'}],
        error: null,
      };
    },
    async signInWithPassword() {
      calls.push('signInWithPassword');
      return {
        session: {access_token: 'access-token', user: {id: 'user-1', email: 'buyer@example.com'}},
        error: null,
      };
    },
    async verifyOtp() {
      calls.push('verifyOtp');
      return {
        session: {access_token: 'access-token', user: {id: 'user-1', email: 'buyer@example.com'}},
        error: null,
      };
    },
    async exchangeCodeForSession() {
      calls.push('exchangeCodeForSession');
      return {
        session: {access_token: 'access-token', user: {id: 'user-1', email: 'buyer@example.com'}},
        error: null,
      };
    },
    async resetPasswordForEmail() {
      calls.push('resetPasswordForEmail');
      return {error: null};
    },
    async resendConfirmationEmail() {
      calls.push('resendConfirmationEmail');
      return {error: null};
    },
    async updateUserPassword() {
      calls.push('updateUserPassword');
      return {error: null};
    },
    async signOut() {
      calls.push('signOut');
      return {error: null};
    },
  };
  return {provider, calls};
}

const VALID_INPUT = {
  email: '  owner@shop.com ',
  password: 'strongpass123',
  fullName: 'Ama Mensah',
  phone: '024 123 4567',
};

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

test('validation: accepts a well-formed email and rejects broken ones', () => {
  assertEqual(validateEmail('owner@shop.com'), null);
  assertEqual(validateEmail('  owner@shop.com  '), null);
  assert(validateEmail('') !== null, 'empty email rejected');
  assert(validateEmail('owner@shop') !== null, 'missing TLD rejected');
  assert(validateEmail('owner shop@shop.com') !== null, 'space rejected');
  assert(validateEmail('owner@@shop.com') !== null, 'double at rejected');
});

test('validation: password requires at least 8 characters', () => {
  assertEqual(validatePassword('strongpass123'), null);
  assert(validatePassword('short7') !== null, 'too short rejected');
  assert(validatePassword('') !== null, 'empty rejected');
  assert(validatePassword('        ') !== null, 'spaces-only rejected');
});

test('validation: full name limits match the profiles schema (1..120)', () => {
  assertEqual(validateFullName('  Ama Mensah '), null);
  assert(validateFullName('') !== null, 'empty rejected');
  assert(validateFullName('x'.repeat(121)) !== null, '121 characters rejected');
  assertEqual(validateFullName('x'.repeat(120)), null);
});

test('validation: phone is optional but must match the DB pattern when given', () => {
  assertEqual(validatePhone(''), null, 'optional field: empty is valid');
  assertEqual(validatePhone('024 123 4567'), null);
  assertEqual(validatePhone('+233241234567'), null);
  assert(validatePhone('abc') !== null, 'letters rejected');
  assert(validatePhone('12345') !== null, 'too short rejected');
});

test('validation: registration aggregates per-field errors', () => {
  const errors = validateRegistration({email: 'bad', password: '123', fullName: '', phone: 'nope'});
  assertEqual(Object.keys(errors).sort(), ['email', 'fullName', 'password', 'phone']);

  const clean = validateRegistration(VALID_INPUT);
  assertEqual(clean, {}, 'valid input produces no errors');
});

// ---------------------------------------------------------------------------
// Feature gates / availability
// ---------------------------------------------------------------------------

test('gates: registration form is hidden while accountEnabled is false', () => {
  const result = accountAvailability({accountEnabled: false}, {supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'sb_publishable_x'});
  assertEqual(result.available, false);
  assertEqual(result.reason, 'disabled');
  assert(result.notice.length > 0, 'notice explains the state');
});

test('gates: registration form is hidden when the backend is not configured', () => {
  const result = accountAvailability({accountEnabled: true}, {});
  assertEqual(result.available, false);
  assertEqual(result.reason, 'not_configured');
});

test('gates: registration form appears only when switched on AND configured', () => {
  const result = accountAvailability(
    {accountEnabled: true},
    {supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'sb_publishable_x'},
  );
  assertEqual(result.available, true);
  assertEqual(result.reason, 'available');
});

test('gates: download requires the download switch, the account switch and configuration', () => {
  const configured = {supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'sb_publishable_x'};
  assertEqual(downloadAvailability({accountEnabled: false, downloadEnabled: false}, configured).reason, 'disabled');
  assertEqual(downloadAvailability({accountEnabled: false, downloadEnabled: true}, configured).reason, 'disabled');
  assertEqual(
    downloadAvailability({accountEnabled: true, downloadEnabled: true}, {}).reason,
    'not_configured',
  );
  assertEqual(downloadAvailability({accountEnabled: true, downloadEnabled: true}, configured).available, true);
});

test('gates: shipped commerce flags are still off (payments and pricing untouched)', () => {
  assertEqual(COMMERCE.accountEnabled, false, 'accountEnabled ships false');
  assertEqual(COMMERCE.paymentsEnabled, false, 'paymentsEnabled ships false');
  assertEqual(COMMERCE.downloadEnabled, false, 'downloadEnabled ships false');
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('routing: account routes are recognised, section anchors are not', () => {
  assertEqual(parseRoute('#/register', '').path, '/register');
  assertEqual(parseRoute('#/download?x=1', '').path, '/download');
  assertEqual(parseRoute('#features', '').path, '/', 'section anchor stays on the home page');
  assertEqual(parseRoute('', '').path, '/');
  assert(isAccountRoute('/register') && isAccountRoute('/download'), 'account routes known');
  assert(!isAccountRoute('/'), 'home is not an account route');
});

test('routing: email-link parameters are read from the hash and the query string', () => {
  const fromHash = parseRoute('#/verify?token_hash=abc123&type=signup', '');
  assertEqual(verificationParams(fromHash.params), {mode: 'otp', tokenHash: 'abc123', type: 'signup'});

  const fromSearch = parseRoute('', '?token_hash=abc123&type=recovery');
  assertEqual(verificationParams(fromSearch.params), {mode: 'otp', tokenHash: 'abc123', type: 'recovery'});

  const pkce = parseRoute('#/verify?code=pkce-code', '');
  assertEqual(verificationParams(pkce.params), {mode: 'code', code: 'pkce-code'});

  assertEqual(verificationParams(parseRoute('#/verify', '').params), null, 'no parameters → no verification');
});

test('routing: next parameter only allows known account destinations', () => {
  const download = parseRoute('#/login?next=download', '');
  assertEqual(nextRouteAfterSignIn(download.params), '/download');
  const junk = parseRoute('#/login?next=https://evil.example', '');
  assertEqual(nextRouteAfterSignIn(junk.params), '/account', 'unknown next falls back to the account page');
  const plain = parseRoute('#/login', '');
  assertEqual(nextRouteAfterSignIn(plain.params), '/account');
});

// ---------------------------------------------------------------------------
// Registration flow
// ---------------------------------------------------------------------------

test('registration: client-side validation runs before the provider is called', async () => {
  const {provider, calls} = baseProvider();
  const result = await registerAccount(provider, {email: 'bad', password: '1', fullName: '', phone: ''});
  assertEqual(result.status, 'invalid_input');
  assertEqual(calls.length, 0, 'provider untouched for invalid input');
});

test('registration without a session reports pending verification, never verified', async () => {
  const {provider} = baseProvider();
  const result = await registerAccount(provider, VALID_INPUT, {emailRedirectTo: 'https://site/#/verify'});
  assertEqual(result.status, 'pending_verification');
  if (result.status === 'pending_verification') {
    assertEqual(result.email, 'owner@shop.com', 'email is trimmed');
    assert(result.message.includes('confirmation link'), 'tells the customer to open the email');
  }
});

test('registration with a returned session reports signed-in (not "verified")', async () => {
  const {provider} = baseProvider();
  const withSession: AuthProvider = {
    ...provider,
    async signUp() {
      return {
        user: {id: 'user-1', email: 'owner@shop.com'},
        session: {access_token: 'tok', user: {id: 'user-1', email: 'owner@shop.com'}},
        identities: [{id: 'i1'}],
        error: null,
      };
    },
  };
  const result = await registerAccount(withSession, VALID_INPUT);
  assertEqual(result.status, 'signed_in');
  if (result.status === 'signed_in') {
    assert(result.message.includes('signed in'), 'reports the real state');
  }
});

test('registration: duplicate email is reported clearly (empty identities guard)', async () => {
  const {provider} = baseProvider();
  const duplicate: AuthProvider = {
    ...provider,
    async signUp() {
      return {user: {id: 'user-1', email: 'owner@shop.com'}, session: null, identities: [], error: null};
    },
  };
  const result = await registerAccount(duplicate, VALID_INPUT);
  assertEqual(result.status, 'duplicate_email');
  if (result.status === 'duplicate_email') {
    assert(result.message.includes('already exists'), 'names the duplicate problem');
  }
});

test('registration: provider duplicate error codes map to duplicate_email', async () => {
  const {provider} = baseProvider();
  const duplicate: AuthProvider = {
    ...provider,
    async signUp() {
      return {user: null, session: null, identities: null, error: {code: 'user_already_exists'}};
    },
  };
  const result = await registerAccount(duplicate, VALID_INPUT);
  assertEqual(result.status, 'duplicate_email');
});

test('registration: provider failures surface an honest error message', async () => {
  const {provider} = baseProvider();
  const broken: AuthProvider = {
    ...provider,
    async signUp() {
      return {user: null, session: null, identities: null, error: {code: 'over_email_send_rate_limit'}};
    },
  };
  const result = await registerAccount(broken, VALID_INPUT);
  assertEqual(result.status, 'error');
  if (result.status === 'error') {
    assertEqual(result.kind, 'rate_limited');
  }
});

test('registration: a thrown network error does not crash the form', async () => {
  const {provider} = baseProvider();
  const offline: AuthProvider = {
    ...provider,
    async signUp() {
      throw new Error('fetch failed');
    },
  };
  const result = await registerAccount(offline, VALID_INPUT);
  assertEqual(result.status, 'error');
  if (result.status === 'error') assertEqual(result.kind, 'network');
});

// ---------------------------------------------------------------------------
// Sign-in / verification / reset flows
// ---------------------------------------------------------------------------

test('sign-in: valid credentials return a session', async () => {
  const {provider, calls} = baseProvider();
  const result = await signInToAccount(provider, {email: 'owner@shop.com', password: 'strongpass123'});
  assertEqual(result.status, 'signed_in');
  assertEqual(calls, ['signInWithPassword']);
});

test('sign-in: empty fields never reach the provider', async () => {
  const {provider, calls} = baseProvider();
  const result = await signInToAccount(provider, {email: '', password: ''});
  assertEqual(result.status, 'invalid_input');
  assertEqual(calls.length, 0);
});

test('sign-in: wrong credentials and unconfirmed email produce distinct messages', async () => {
  const {provider} = baseProvider();
  const badPassword: AuthProvider = {
    ...provider,
    async signInWithPassword() {
      return {session: null, error: {code: 'invalid_credentials'}};
    },
  };
  const bad = await signInToAccount(badPassword, {email: 'owner@shop.com', password: 'wrongpass1'});
  assertEqual(bad.status, 'error');
  if (bad.status === 'error') assertEqual(bad.kind, 'invalid_credentials');

  const unconfirmed: AuthProvider = {
    ...provider,
    async signInWithPassword() {
      return {session: null, error: {code: 'email_not_confirmed'}};
    },
  };
  const pending = await signInToAccount(unconfirmed, {email: 'owner@shop.com', password: 'strongpass123'});
  assertEqual(pending.status, 'error');
  if (pending.status === 'error') {
    assertEqual(pending.kind, 'email_not_confirmed');
    assert(pending.message.includes('not been verified'), 'states verification is missing');
  }
});

test('verification: only a returned session counts as verified', async () => {
  const {provider, calls} = baseProvider();

  const verified = await verifyEmailAddress(provider, {mode: 'otp', tokenHash: 'hash', type: 'signup'});
  assertEqual(verified.status, 'verified');
  assertEqual(calls, ['verifyOtp']);

  const noParams = await verifyEmailAddress(provider, null);
  assertEqual(noParams.status, 'invalid_input', 'incomplete link is rejected');

  const silent: AuthProvider = {
    ...provider,
    async verifyOtp() {
      return {session: null, error: null};
    },
  };
  const noSession = await verifyEmailAddress(silent, {mode: 'otp', tokenHash: 'hash', type: 'signup'});
  assert(noSession.status !== 'verified', 'no session ⇒ never reports verified');
});

test('verification: PKCE code exchange path is supported', async () => {
  const {provider, calls} = baseProvider();
  const result = await verifyEmailAddress(provider, {mode: 'code', code: 'pkce-code'});
  assertEqual(result.status, 'verified');
  assertEqual(calls, ['exchangeCodeForSession']);
});

test('verification: expired or invalid links fail with a usable message', async () => {
  const {provider} = baseProvider();
  const expired: AuthProvider = {
    ...provider,
    async verifyOtp() {
      return {session: null, error: {code: 'otp_expired'}};
    },
  };
  const result = await verifyEmailAddress(expired, {mode: 'otp', tokenHash: 'old', type: 'signup'});
  assertEqual(result.status, 'error');
  if (result.status === 'error') assertEqual(result.kind, 'invalid_link');
});

test('password reset: request validates the email and reports a sent state', async () => {
  const {provider, calls} = baseProvider();

  const invalid = await requestPasswordReset(provider, 'not-an-email');
  assertEqual(invalid.status, 'invalid_input');
  assertEqual(calls.length, 0);

  const sent = await requestPasswordReset(provider, 'owner@shop.com', {redirectTo: 'https://site/#/reset-password'});
  assertEqual(sent.status, 'sent');
  if (sent.status === 'sent') {
    assert(sent.message.includes('If an account exists'), 'does not confirm whether the account exists');
  }
});

test('password reset: unknown account is reported without pretending to send', async () => {
  const {provider} = baseProvider();
  const missing: AuthProvider = {
    ...provider,
    async resetPasswordForEmail() {
      return {error: {code: 'user_not_found'}};
    },
  };
  const result = await requestPasswordReset(missing, 'nobody@shop.com');
  assertEqual(result.status, 'error');
  if (result.status === 'error') assertEqual(result.kind, 'no_account');
});

test('new password: validation, success and same-password rejection', async () => {
  const {provider, calls} = baseProvider();

  const tooShort = await setNewPassword(provider, 'abc');
  assertEqual(tooShort.status, 'invalid_input');
  assertEqual(calls.length, 0);

  const ok = await setNewPassword(provider, 'brandnewpass99');
  assertEqual(ok.status, 'updated');
  assertEqual(calls, ['updateUserPassword']);

  const same: AuthProvider = {
    ...provider,
    async updateUserPassword() {
      return {error: {code: 'same_password'}};
    },
  };
  const repeated = await setNewPassword(same, 'brandnewpass99');
  assertEqual(repeated.status, 'error');
  if (repeated.status === 'error') assertEqual(repeated.kind, 'same_password');
});

test('confirmation email can be re-sent for an unverified address', async () => {
  const {provider, calls} = baseProvider();
  const result = await resendConfirmation(provider, 'owner@shop.com', {redirectTo: 'https://site/#/verify'});
  assertEqual(result.status, 'sent');
  assertEqual(calls, ['resendConfirmationEmail']);
});

test('auth errors: unknown codes fall back to a context-specific message', () => {
  const fallback = classifyAuthError({code: 'something_new'}, 'signUp');
  assertEqual(fallback.kind, 'unknown');
  assert(fallback.message.length > 0, 'still gives the customer a sentence');

  const none = classifyAuthError(null, 'signIn');
  assert(none.kind === 'unknown' && none.message.includes('sign you in'), 'context-sensitive fallback');
});
