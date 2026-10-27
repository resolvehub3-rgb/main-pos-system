/**
 * Paystack webhook signature verification.
 *
 * Paystack signs every webhook with HMAC-SHA512 over the RAW request body
 * using the integration's secret key, delivered in the
 * `x-paystack-signature` header (lowercase hex digest, 128 characters).
 *
 * Verification rules:
 *  - the HMAC is computed over the exact bytes received (never over a
 *    re-serialised JSON object — key order/whitespace would break it),
 *  - the header must be a well-formed 128-char hex digest,
 *  - comparison is constant-time.
 *
 * Reference: https://paystack.com/docs/payments/webhooks/
 * (also recommends fast-acking requests and the Paystack egress IP
 * allowlist 52.31.139.75, 52.49.173.169, 52.214.14.220 — see api/README.md).
 *
 * Tested against the RFC 4231 §4.3 HMAC-SHA-512 test vector in
 * landing/tests/signature.test.ts.
 */

import {bytesToHex, constantTimeEquals, utf8ToBytes, type Bytes} from './codec.ts';

const SHA512_HEX_LENGTH = 128;

export async function computePaystackSignature(rawBody: Bytes | string, secret: string): Promise<string> {
  const bytes = typeof rawBody === 'string' ? utf8ToBytes(rawBody) : rawBody;
  const key = await crypto.subtle.importKey(
    'raw',
    utf8ToBytes(secret),
    {name: 'HMAC', hash: 'SHA-512'},
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, bytes);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Verify a Paystack `x-paystack-signature` value against the raw body.
 * Returns false (never throws) for missing/malformed headers or mismatches,
 * so callers can answer 401 uniformly without leaking a timing signal.
 */
export async function verifyPaystackSignature(
  rawBody: Bytes,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const provided = signatureHeader.trim().toLowerCase();
  if (provided.length !== SHA512_HEX_LENGTH || !/^[0-9a-f]+$/.test(provided)) {
    return false;
  }
  const expected = await computePaystackSignature(rawBody, secret);
  return constantTimeEquals(expected, provided);
}
