/**
 * Cashier PIN primitives: format, device-side hashing, lockout policy.
 *
 * Design rules (docs/SECURITY.md §3b.5):
 *  - A PIN is NEVER held in plaintext on the device, in memory beyond the
 *    sign-in attempt, or in any mirror. What the till keeps is a salted
 *    PBKDF2-SHA256 hash so a cashier can still sign in during an outage
 *    (offline sales must keep working), while the backend verifies the same
 *    PIN against a bcrypt hash whenever there is a connection.
 *  - Two hashes of the same PIN, two purposes: bcrypt lives server-side in
 *    `public.cashier_pins` (cost factor makes offline brute force expensive);
 *    PBKDF2 lives device-side because WebCrypto ships in every browser and
 *    Node, so no dependency is needed.
 *  - Lockout policy lives here as data (5 wrong → 15 minutes) so the device
 *    and the SQL verifier enforce the same rule. The server copy is
 *    authoritative online; the device copy protects an offline till.
 *
 * Pure module: no imports from the app, no Supabase, no DOM — unit-testable
 * under `tsx --test` with nothing but node:assert.
 */

/** Wrong PINs allowed in a row before the PIN locks. */
export const PIN_MAX_ATTEMPTS = 5;

/** How long a locked PIN stays locked. */
export const PIN_LOCKOUT_MS = 15 * 60 * 1000;

/** A cashier PIN is 4–6 digits and nothing else. */
const PIN_PATTERN = /^\d{4,6}$/;

const HASH_SCHEME = 'pbkdf2-sha256';
const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** True when `pin` is a usable 4–6 digit numeric PIN. */
export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) {
    // Every supported runtime has WebCrypto (browsers since forever, Node 15+).
    // Refusing loudly beats storing an unhashed PIN as a fallback.
    throw new Error('WebCrypto (crypto.subtle) is unavailable — cannot hash a PIN safely.');
  }
  return s;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveBits(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<ArrayBuffer> {
  const api = subtle();
  const key = await api.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return api.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BITS);
}

/**
 * Hash a PIN for device storage: `pbkdf2-sha256$<iterations>$<salt>$<hash>`.
 *
 * Random salt per PIN means two cashiers with the same PIN never share a
 * stored value, and the iterations count is carried in the string so a future
 * bump can re-hash on next set without breaking existing hashes.
 *
 * Throws for a malformed PIN or a runtime without WebCrypto — callers validate
 * with `isValidPin` first and surface the message instead of failing silently.
 */
export async function hashPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) throw new Error('PIN must be 4 to 6 digits.');
  const salt = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  const bits = await deriveBits(pin, salt, DEFAULT_ITERATIONS);
  return `${HASH_SCHEME}$${DEFAULT_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(
    new Uint8Array(bits)
  )}`;
}

/** Constant-time-ish byte comparison: never bails early on the first byte. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Verify a PIN against a stored device hash.
 *
 * An absent/malformed stored value is a FAILED verification, never a bypass —
 * the same rule the password path enforces ("no credential → no sign-in").
 */
export async function verifyPin(pin: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || !isValidPin(pin)) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== HASH_SCHEME) return false;

  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1 || iterations > 10_000_000) return false;

  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(parts[2]);
    expected = base64ToBytes(parts[3]);
  } catch {
    return false; // corrupt stored value → refuse, do not crash the sign-in
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const bits = await deriveBits(pin, salt, iterations);
  return bytesEqual(new Uint8Array(bits), expected);
}

/** Evaluated lockout position for one cashier. */
export interface PinLockState {
  locked: boolean;
  /** Milliseconds until an active lock expires (0 when not locked). */
  remainingMs: number;
  /** Wrong attempts still available before the lock (0 while locked). */
  attemptsLeft: number;
}

/**
 * Evaluate lockout state from the stored counters.
 *
 * An expired lock reads as unlocked — the caller resets the counters then, so
 * a cashier whose lock ran out starts a fresh window of 5 attempts.
 */
export function lockoutState(
  failedCount: number,
  lockedUntil: string | null | undefined,
  now: number = Date.now()
): PinLockState {
  const until = lockedUntil ? new Date(lockedUntil).getTime() : 0;
  if (Number.isFinite(until) && until > now) {
    return { locked: true, remainingMs: until - now, attemptsLeft: 0 };
  }
  if (lockedUntil && Number.isFinite(until) && until > 0) {
    return { locked: false, remainingMs: 0, attemptsLeft: PIN_MAX_ATTEMPTS };
  }
  const failed = Math.max(0, Math.floor(failedCount));
  return {
    locked: false,
    remainingMs: 0,
    attemptsLeft: Math.max(0, PIN_MAX_ATTEMPTS - failed),
  };
}

/** User-facing lockout message with a `m:ss` countdown. */
export function lockoutMessage(remainingMs: number): string {
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const stamp = minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
  return `Too many incorrect PINs. This PIN is locked for ${stamp}. Try again shortly.`;
}

/**
 * User-facing wrong-PIN message: a simple error plus what is left before the
 * lockout, so a cashier is never guessing how close they are.
 */
export function attemptsLeftMessage(attemptsLeft: number): string {
  if (attemptsLeft <= 0) return lockoutMessage(PIN_LOCKOUT_MS);
  const noun = attemptsLeft === 1 ? 'attempt' : 'attempts';
  return `Incorrect PIN. ${attemptsLeft} ${noun} left before this PIN locks for 15 minutes.`;
}
