/**
 * Supabase session (JWT) verification tests.
 *
 * Tokens are signed locally with WebCrypto using the same algorithm the
 * verifier checks (HS256) — the interesting assertions here are the
 * REJECTIONS: algorithm confusion, tampering, expiry, wrong issuer/audience
 * and anon-role tokens must all fail closed.
 */

import {bytesToBase64Url, utf8ToBytes} from '../api/_lib/codec.ts';
import {verifySupabaseJwt} from '../api/_lib/jwt.ts';
import {assert, assertEqual, test} from './harness.ts';

const SECRET = 'local-test-jwt-secret-0123456789abcdef';
const ISSUER = 'https://commerce-test.supabase.co/auth/v1';
const NOW = 1_780_000_000; // fixed clock for deterministic tests

interface Claims {
  sub?: string;
  role?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
  [key: string]: unknown;
}

async function signToken(
  payload: Claims,
  secret: string = SECRET,
  header: Record<string, unknown> = {alg: 'HS256', typ: 'JWT'},
): Promise<string> {
  const headerB64 = bytesToBase64Url(utf8ToBytes(JSON.stringify(header)));
  const payloadB64 = bytesToBase64Url(utf8ToBytes(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    utf8ToBytes(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, utf8ToBytes(`${headerB64}.${payloadB64}`));
  return `${headerB64}.${payloadB64}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function baseClaims(overrides: Claims = {}): Claims {
  return {
    sub: 'a1b2c3d4-0000-4000-8000-000000000001',
    role: 'authenticated',
    aud: 'authenticated',
    iss: ISSUER,
    exp: NOW + 3600,
    email: 'buyer@example.com',
    ...overrides,
  };
}

const OPTIONS = {secret: SECRET, expectedIssuer: ISSUER, expectedAudience: 'authenticated', nowSeconds: NOW};

test('valid token is accepted with expected claims', async () => {
  const token = await signToken(baseClaims());
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(result.ok, `expected ok, got ${result.ok ? '' : result.reason}`);
  assertEqual(result.claims.sub, 'a1b2c3d4-0000-4000-8000-000000000001');
  assertEqual(result.claims.email, 'buyer@example.com');
  assertEqual(result.claims.role, 'authenticated');
});

test('expired token is rejected', async () => {
  const token = await signToken(baseClaims({exp: NOW - 3600}));
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'expired token must not verify');
  assertEqual(result.reason, 'token_expired');
});

test('token expired within the 30s clock skew still verifies', async () => {
  const token = await signToken(baseClaims({exp: NOW - 10}));
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(result.ok, `skewed-but-fresh token should verify, got ${result.ok ? '' : result.reason}`);
});

test('future nbf is rejected', async () => {
  const token = await signToken(baseClaims({nbf: NOW + 600}));
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'future nbf must not verify');
  assertEqual(result.reason, 'token_not_yet_valid');
});

test('tampered payload is rejected', async () => {
  const token = await signToken(baseClaims());
  const [header, , signature] = token.split('.');
  const forgedPayload = bytesToBase64Url(
    utf8ToBytes(JSON.stringify(baseClaims({sub: 'attacker-user-id'}))),
  );
  const result = await verifySupabaseJwt(`${header}.${forgedPayload}.${signature}`, OPTIONS);
  assert(!result.ok, 'tampered payload must not verify');
  assertEqual(result.reason, 'bad_signature');
});

test('alg:none header is rejected', async () => {
  const token = await signToken(baseClaims(), SECRET, {alg: 'none', typ: 'JWT'});
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'alg none must not verify');
  assertEqual(result.reason, 'unsupported_algorithm');
});

test('HS384/other algorithms are rejected', async () => {
  const token = await signToken(baseClaims(), SECRET, {alg: 'HS512', typ: 'JWT'});
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'non-HS256 alg must not verify');
  assertEqual(result.reason, 'unsupported_algorithm');
});

test('wrong signing secret is rejected', async () => {
  const token = await signToken(baseClaims());
  const result = await verifySupabaseJwt(token, {...OPTIONS, secret: 'some-other-secret-value'});
  assert(!result.ok, 'wrong secret must not verify');
  assertEqual(result.reason, 'bad_signature');
});

test('wrong issuer is rejected', async () => {
  const token = await signToken(baseClaims({iss: 'https://evil.example.co/auth/v1'}));
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'wrong issuer must not verify');
  assertEqual(result.reason, 'issuer_mismatch');
});

test('issuer with trailing slash is tolerated', async () => {
  const token = await signToken(baseClaims({iss: `${ISSUER}/`}));
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(result.ok, `trailing slash issuer should verify, got ${result.ok ? '' : result.reason}`);
});

test('wrong audience is rejected', async () => {
  const token = await signToken(baseClaims({aud: 'service_role'}));
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'wrong audience must not verify');
  assertEqual(result.reason, 'audience_mismatch');
});

test('anon role token is rejected', async () => {
  const token = await signToken(baseClaims({role: 'anon'}));
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'anon role must not verify');
  assertEqual(result.reason, 'wrong_role');
});

test('missing role claim is rejected', async () => {
  const claims = baseClaims();
  delete claims.role;
  const token = await signToken(claims);
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'missing role must not verify');
  assertEqual(result.reason, 'wrong_role');
});

test('missing sub is rejected', async () => {
  const claims = baseClaims();
  delete claims.sub;
  const token = await signToken(claims);
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'missing sub must not verify');
  assertEqual(result.reason, 'missing_sub');
});

test('missing exp is rejected', async () => {
  const claims = baseClaims();
  delete claims.exp;
  const token = await signToken(claims);
  const result = await verifySupabaseJwt(token, OPTIONS);
  assert(!result.ok, 'missing exp must not verify');
  assertEqual(result.reason, 'missing_exp');
});

test('malformed tokens are rejected without throwing', async () => {
  for (const token of ['', 'abc', 'a.b', 'a..c', 'a.b.c.d']) {
    const result = await verifySupabaseJwt(token, OPTIONS);
    assert(!result.ok, `malformed token "${token}" must not verify`);
    assertEqual(result.reason, 'malformed_token');
  }
});
