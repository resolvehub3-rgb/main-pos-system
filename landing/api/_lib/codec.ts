/**
 * Byte/string codecs shared by the commerce API.
 *
 * Dependency-free and side-effect-free so the unit tests can exercise the
 * exact code the serverless functions run. Uses only Web-standard APIs
 * (TextEncoder, atob/btoa) — no Node.js imports, which keeps this code
 * type-checked under the project's DOM lib and runnable by the Vercel
 * Node.js runtime alike.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The byte type used across the API: an ArrayBuffer-backed Uint8Array.
 * TypeScript 5.7+ made Uint8Array generic (`Uint8Array<ArrayBufferLike>`,
 * which also covers SharedArrayBuffer), but the WebCrypto APIs only accept
 * `BufferSource` = ArrayBufferView<ArrayBuffer>. Typing our byte values
 * explicitly as `Bytes` keeps every crypto call type-safe without casts.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export function utf8ToBytes(text: string): Bytes {
  return encoder.encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Strict hex decode; returns null for anything that is not clean hex. */
export function hexToBytes(hex: string): Bytes | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** base64url (RFC 4648 §5) -> bytes. Throws on malformed input. */
export function base64UrlToBytes(value: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('invalid base64url characters');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** bytes -> base64url without padding. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Constant-time string comparison for equal-length secrets/hex digests.
 *
 * JavaScript cannot guarantee perfect timing independence, but this avoids
 * the obvious early-exit leak of a naive `===` over attacker-controlled
 * input. Length is compared first (a length oracle on a fixed-size hex
 * digest is harmless).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
