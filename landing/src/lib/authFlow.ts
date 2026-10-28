/**
 * Customer account flows (pure orchestration — unit-tested).
 *
 * The module never talks to Supabase directly: it drives the narrow
 * `AuthProvider` interface, so tests can exercise registration, duplicate
 * handling, the verification flow, sign-in/out and password reset with a
 * fake provider while the browser uses a thin adapter over
 * `@supabase/supabase-js` (see src/lib/supabaseAdapter.ts).
 *
 * HONESTY RULES encoded here:
 * - A sign-up that returns NO session means "confirmation email sent" — the
 *   outcome is `pending_verification`, never `verified`.
 * - The outcome `verified` is produced ONLY when the provider actually
 *   returns a session for the verification link/OTP.
 * - Passwords travel to the provider over HTTPS and are never stored here.
 */

import {
  validateEmail,
  validateNewPassword,
  validatePassword,
  validateRegistration,
  validateSignIn,
  type FieldErrors,
} from './validation.ts';

export interface AuthUserLike {
  id: string;
  email?: string;
}

export interface AuthSessionLike {
  access_token: string;
  user?: AuthUserLike;
}

export interface AuthErrorLike {
  code?: string;
  message?: string;
}

export interface SignUpPayload {
  email: string;
  password: string;
  /** Supabase user metadata (display name only — no extra personal data). */
  fullName?: string;
  /** Where the confirmation email should send the customer back to. */
  emailRedirectTo?: string;
}

export interface AuthProvider {
  signUp(input: {
    email: string;
    password: string;
    data?: Record<string, unknown>;
    options?: {emailRedirectTo?: string};
  }): Promise<{user: AuthUserLike | null; session: AuthSessionLike | null; identities: Array<{id: string}> | null; error: AuthErrorLike | null}>;

  signInWithPassword(input: {email: string; password: string}): Promise<{session: AuthSessionLike | null; error: AuthErrorLike | null}>;

  verifyOtp(input: {tokenHash: string; type: string}): Promise<{session: AuthSessionLike | null; error: AuthErrorLike | null}>;

  exchangeCodeForSession(code: string): Promise<{session: AuthSessionLike | null; error: AuthErrorLike | null}>;

  resetPasswordForEmail(email: string, options: {redirectTo?: string}): Promise<{error: AuthErrorLike | null}>;

  /** Re-send the confirmation email for an address that is not verified yet. */
  resendConfirmationEmail(email: string, options: {redirectTo?: string}): Promise<{error: AuthErrorLike | null}>;

  updateUserPassword(password: string): Promise<{error: AuthErrorLike | null}>;

  signOut(): Promise<{error: AuthErrorLike | null}>;
}

export type AuthProblemKind =
  | 'duplicate_email'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'no_account'
  | 'rate_limited'
  | 'weak_password'
  | 'same_password'
  | 'invalid_link'
  | 'signup_disabled'
  | 'network'
  | 'unknown';

/**
 * Translate a provider error into an honest, customer-facing message.
 * Unknown codes fall back to a context-specific generic sentence — we never
 * invent a success claim from an error.
 */
export function classifyAuthError(
  error: AuthErrorLike | null | undefined,
  context: 'signUp' | 'signIn' | 'verify' | 'reset' | 'updatePassword',
): {kind: AuthProblemKind; message: string} {
  if (!error) {
    return {kind: 'unknown', message: fallbackMessage(context)};
  }
  const code = (error.code ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();

  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    code === 'identity_already_exists' ||
    message.includes('already registered') ||
    message.includes('already been registered')
  ) {
    return {
      kind: 'duplicate_email',
      message: 'An account already exists for this email address. Sign in instead, or reset your password if you have forgotten it.',
    };
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return {
      kind: 'invalid_credentials',
      message: 'That email address and password combination is not correct.',
    };
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return {
      kind: 'email_not_confirmed',
      message: 'Your email address has not been verified yet. Open the confirmation link we emailed you, then sign in again.',
    };
  }
  if (code === 'user_not_found' || message.includes('user not found')) {
    return {
      kind: 'no_account',
      message: context === 'reset'
        ? 'No account was found for that email address. Check the address or register a new account.'
        : 'No account exists for that email address. Register first.',
    };
  }
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    code === 'rate_limit_exceeded' ||
    code === 'too_many_requests' ||
    message.includes('rate limit')
  ) {
    return {
      kind: 'rate_limited',
      message: 'Too many attempts. Please wait a minute and try again.',
    };
  }
  if (code === 'weak_password' || code === 'password_too_short') {
    return {
      kind: 'weak_password',
      message: 'That password is too weak. Use at least 8 characters.',
    };
  }
  if (code === 'same_password') {
    return {
      kind: 'same_password',
      message: 'Choose a password different from your current one.',
    };
  }
  if (
    code === 'otp_expired' ||
    code === 'session_not_found' ||
    code === 'refresh_token_not_found' ||
    code === 'bad_code_verifier' ||
    code === 'validation_failed' && context === 'verify' ||
    message.includes('expired') ||
    message.includes('token not found') ||
    message.includes('code verifier')
  ) {
    return {
      kind: 'invalid_link',
      message: 'This link is invalid or has expired. Request a new one and open it promptly.',
    };
  }
  if (code === 'signup_disabled') {
    return {
      kind: 'signup_disabled',
      message: 'Registration is currently disabled. Please contact SamTeck Digital.',
    };
  }
  if (
    code === 'unexpected_failure' ||
    code === 'fetch_error' ||
    code === 'failed' ||
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('failed to fetch')
  ) {
    return {
      kind: 'network',
      message: 'Could not reach the account service. Check your internet connection and try again.',
    };
  }

  return {kind: 'unknown', message: fallbackMessage(context)};
}

function fallbackMessage(context: 'signUp' | 'signIn' | 'verify' | 'reset' | 'updatePassword'): string {
  switch (context) {
    case 'signUp':
      return 'We could not create the account right now. Please try again.';
    case 'signIn':
      return 'We could not sign you in right now. Please try again.';
    case 'verify':
      return 'We could not verify this link right now. Please try again.';
    case 'reset':
      return 'We could not start the password reset right now. Please try again.';
    case 'updatePassword':
      return 'We could not update your password right now. Please try again.';
  }
}

export type RegisterOutcome =
  | {status: 'pending_verification'; email: string; message: string}
  | {status: 'signed_in'; session: AuthSessionLike; message: string}
  | {status: 'duplicate_email'; message: string}
  | {status: 'invalid_input'; errors: FieldErrors}
  | {status: 'error'; kind: AuthProblemKind; message: string};

export async function registerAccount(
  provider: AuthProvider,
  input: RegistrationInputLike,
  options: {emailRedirectTo?: string} = {},
): Promise<RegisterOutcome> {
  const errors = validateRegistration(input);
  if (Object.keys(errors).length > 0) {
    return {status: 'invalid_input', errors};
  }

  let response;
  try {
    response = await provider.signUp({
      email: input.email.trim(),
      password: input.password,
      data: {full_name: input.fullName.trim(), ...(input.phone.trim() ? {phone: input.phone.trim()} : {})},
      options: options.emailRedirectTo ? {emailRedirectTo: options.emailRedirectTo} : undefined,
    });
  } catch {
    return {status: 'error', kind: 'network', message: classifyAuthError(null, 'signUp').message};
  }

  if (response.error) {
    const {kind, message} = classifyAuthError(response.error, 'signUp');
    if (kind === 'duplicate_email') return {status: 'duplicate_email', message};
    return {status: 'error', kind, message};
  }

  // With email confirmation enabled, Supabase returns a user with an EMPTY
  // identities array when the address already exists (enumeration guard).
  if (response.user && response.identities !== null && response.identities.length === 0) {
    return {status: 'duplicate_email', message: classifyAuthError({code: 'user_already_exists'}, 'signUp').message};
  }

  if (response.session) {
    return {
      status: 'signed_in',
      session: response.session,
      message: 'Your account has been created and you are signed in.',
    };
  }

  return {
    status: 'pending_verification',
    email: input.email.trim(),
    message:
      'Your account has been created. Open the confirmation link we sent to your email address to verify it, then sign in.',
  };
}

export interface RegistrationInputLike {
  email: string;
  password: string;
  fullName: string;
  phone: string;
}

export type SignInOutcome =
  | {status: 'signed_in'; session: AuthSessionLike}
  | {status: 'invalid_input'; errors: FieldErrors}
  | {status: 'error'; kind: AuthProblemKind; message: string};

export async function signInToAccount(
  provider: AuthProvider,
  input: {email: string; password: string},
): Promise<SignInOutcome> {
  const errors = validateSignIn(input);
  if (Object.keys(errors).length > 0) {
    return {status: 'invalid_input', errors};
  }

  let response;
  try {
    response = await provider.signInWithPassword({email: input.email.trim(), password: input.password});
  } catch {
    return {status: 'error', kind: 'network', message: classifyAuthError(null, 'signIn').message};
  }

  if (response.error || !response.session) {
    const {kind, message} = classifyAuthError(response.error, 'signIn');
    return {status: 'error', kind, message};
  }
  return {status: 'signed_in', session: response.session};
}

export type VerifyOutcome =
  | {status: 'verified'; session: AuthSessionLike}
  | {status: 'invalid_input'; message: string}
  | {status: 'error'; kind: AuthProblemKind; message: string};

/**
 * Complete email verification (or a recovery link) from the parameters the
 * provider appended to the redirect URL. `verified` is returned ONLY when a
 * session comes back — otherwise the customer is told the link failed.
 */
export async function verifyEmailAddress(
  provider: AuthProvider,
  params: {mode: 'otp'; tokenHash: string; type: string} | {mode: 'code'; code: string} | null,
): Promise<VerifyOutcome> {
  if (!params) {
    return {
      status: 'invalid_input',
      message: 'This verification link is incomplete. Open the latest email and use the link inside it.',
    };
  }

  let response;
  try {
    response =
      params.mode === 'otp'
        ? await provider.verifyOtp({tokenHash: params.tokenHash, type: params.type})
        : await provider.exchangeCodeForSession(params.code);
  } catch {
    return {status: 'error', kind: 'network', message: classifyAuthError(null, 'verify').message};
  }

  if (response.error || !response.session) {
    const {kind, message} = classifyAuthError(response.error, 'verify');
    return {status: 'error', kind, message};
  }
  return {status: 'verified', session: response.session};
}

export type ResetRequestOutcome =
  | {status: 'sent'; message: string}
  | {status: 'invalid_input'; message: string}
  | {status: 'error'; kind: AuthProblemKind; message: string};

export async function requestPasswordReset(
  provider: AuthProvider,
  email: string,
  options: {redirectTo?: string} = {},
): Promise<ResetRequestOutcome> {
  const invalid = validateEmail(email);
  if (invalid) return {status: 'invalid_input', message: invalid};

  let response;
  try {
    response = await provider.resetPasswordForEmail(email.trim(), {
      redirectTo: options.redirectTo,
    });
  } catch {
    return {status: 'error', kind: 'network', message: classifyAuthError(null, 'reset').message};
  }

  if (response.error) {
    const {kind, message} = classifyAuthError(response.error, 'reset');
    return {status: 'error', kind, message};
  }
  return {
    status: 'sent',
    message:
      'If an account exists for that address, a password reset link has been sent. Open it to choose a new password.',
  };
}

export type ResendConfirmationOutcome =
  | {status: 'sent'; message: string}
  | {status: 'invalid_input'; message: string}
  | {status: 'error'; kind: AuthProblemKind; message: string};

/**
 * Ask the provider to send (another) confirmation email. Success only means
 * "the email was queued" — the address stays unverified until the customer
 * opens the link and a session comes back.
 */
export async function resendConfirmation(
  provider: AuthProvider,
  email: string,
  options: {redirectTo?: string} = {},
): Promise<ResendConfirmationOutcome> {
  const invalid = validateEmail(email);
  if (invalid) return {status: 'invalid_input', message: invalid};

  let response;
  try {
    response = await provider.resendConfirmationEmail(email.trim(), {
      redirectTo: options.redirectTo,
    });
  } catch {
    return {status: 'error', kind: 'network', message: classifyAuthError(null, 'reset').message};
  }

  if (response.error) {
    const {kind, message} = classifyAuthError(response.error, 'reset');
    return {status: 'error', kind, message};
  }
  return {
    status: 'sent',
    message: 'A new confirmation email has been sent. Open the link inside it to verify your address.',
  };
}

export type PasswordUpdateOutcome =
  | {status: 'updated'; message: string}
  | {status: 'invalid_input'; message: string}
  | {status: 'error'; kind: AuthProblemKind; message: string};

export async function setNewPassword(
  provider: AuthProvider,
  password: string,
): Promise<PasswordUpdateOutcome> {
  const invalid = validateNewPassword(password);
  if (invalid) return {status: 'invalid_input', message: invalid};

  let response;
  try {
    response = await provider.updateUserPassword(password);
  } catch {
    return {status: 'error', kind: 'network', message: classifyAuthError(null, 'updatePassword').message};
  }

  if (response.error) {
    const {kind, message} = classifyAuthError(response.error, 'updatePassword');
    return {status: 'error', kind, message};
  }
  return {status: 'updated', message: 'Your password has been updated. Use it the next time you sign in.'};
}

/** Sign out, ignoring (but surfacing) provider errors — local state clears regardless. */
export async function signOutAccount(provider: AuthProvider): Promise<{ok: boolean; message?: string}> {
  try {
    const response = await provider.signOut();
    if (response.error) {
      const {message} = classifyAuthError(response.error, 'signIn');
      return {ok: false, message};
    }
    return {ok: true};
  } catch {
    return {ok: false, message: classifyAuthError(null, 'signIn').message};
  }
}

/** Re-exported so form code needs one import for the password rule. */
export {validatePassword};
