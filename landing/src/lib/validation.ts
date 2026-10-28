/**
 * Registration and account form validation (pure).
 *
 * No framework, no environment, no network — this module only inspects the
 * strings a customer typed, so the exact rules are unit-tested in
 * tests/validation.test.ts.
 *
 * Field rules mirror the commerce database schema (db/migrations/0001):
 *   - profiles.email    NOT NULL, format  ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
 *   - profiles.full_name nullable, 1..120 characters
 *   - profiles.phone    nullable, ~ '^\+?[0-9][0-9 ]{6,19}$'
 * Password length is a client-side rule only; the commerce Supabase project
 * enforces its own password policy server-side (never trust the browser).
 *
 * Only the fields the existing account model stores are collected: email,
 * password, full name and (optionally) a phone number. No shop details, no
 * ID numbers, no extra personal data — a website account is NOT a POS tenant
 * and does not activate a licence.
 */

/** Same shape as the profiles.email CHECK constraint. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** Same shape as the profiles.phone CHECK constraint. */
export const PHONE_PATTERN = /^\+?[0-9][0-9 ]{6,19}$/;

/** Client-side minimum. The auth provider enforces its own policy server-side. */
export const PASSWORD_MIN_LENGTH = 8;

/** Upper bound kept generous; long passphrases stay welcome. */
export const PASSWORD_MAX_LENGTH = 200;

export const FULL_NAME_MAX_LENGTH = 120;

export interface RegistrationInput {
  email: string;
  password: string;
  fullName: string;
  phone: string;
}

export type RegistrationField = keyof RegistrationInput;

/** Field name → first human-readable problem; empty/absent means valid. */
export type FieldErrors<T extends string = string> = Partial<Record<T, string>>;

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (email === '') return 'Enter your email address.';
  if (email.length > 254) return 'That email address is too long.';
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address, for example name@shop.com.';
  return null;
}

export function validatePassword(value: string): string | null {
  if (value === '') return 'Choose a password.';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (value.trim() === '') return 'Password cannot be only spaces.';
  return null;
}

export function validateFullName(value: string): string | null {
  const name = value.trim();
  if (name === '') return 'Enter your full name.';
  if (name.length > FULL_NAME_MAX_LENGTH) {
    return `Use at most ${FULL_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

/** Phone is optional; an empty value is valid. */
export function validatePhone(value: string): string | null {
  const phone = value.trim();
  if (phone === '') return null;
  if (!PHONE_PATTERN.test(phone)) {
    return 'Enter a valid phone number, for example 024 123 4567.';
  }
  return null;
}

export function validateRegistration(input: RegistrationInput): FieldErrors<RegistrationField> {
  const errors: FieldErrors<RegistrationField> = {};
  const email = validateEmail(input.email);
  if (email) errors.email = email;
  const password = validatePassword(input.password);
  if (password) errors.password = password;
  const fullName = validateFullName(input.fullName);
  if (fullName) errors.fullName = fullName;
  const phone = validatePhone(input.phone);
  if (phone) errors.phone = phone;
  return errors;
}

export interface SignInInput {
  email: string;
  password: string;
}

export function validateSignIn(input: SignInInput): FieldErrors<RegistrationField> {
  const errors: FieldErrors<RegistrationField> = {};
  const email = validateEmail(input.email);
  if (email) errors.email = email;
  if (input.password === '') errors.password = 'Enter your password.';
  return errors;
}

/** Forgot-password form: email only. */
export function validateResetRequest(email: string): string | null {
  return validateEmail(email);
}

/** New password chosen on the recovery screen. */
export function validateNewPassword(password: string): string | null {
  return validatePassword(password);
}

/** True when there is at least one problem to show. */
export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((message) => Boolean(message));
}
