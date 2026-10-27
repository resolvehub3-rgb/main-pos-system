/**
 * Paystack webhook signature verification tests.
 *
 * The primary vector is the RFC 4231 §4.3 HMAC-SHA-512 test case (key
 * "Jefe"), independently verified against the RFC text — this anchors our
 * WebCrypto implementation to a published standard rather than to itself.
 */

import {computePaystackSignature, verifyPaystackSignature} from '../api/_lib/paystack-signature.ts';
import {utf8ToBytes} from '../api/_lib/codec.ts';
import {assert, assertEqual, test} from './harness.ts';

const RFC4231_TC2_KEY = 'Jefe';
const RFC4231_TC2_DATA = 'what do ya want for nothing?';
const RFC4231_TC2_HMAC_SHA512 =
  '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea250554' +
  '9758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737';

const TEST_SECRET = 'sk_test_local_only_not_a_real_key_000000';
const BODY = JSON.stringify({
  event: 'charge.success',
  data: {id: 555001, reference: 'st_abc123def456', amount: 89900, currency: 'GHS'},
});

test('HMAC-SHA-512 matches the RFC 4231 test vector', async () => {
  const digest = await computePaystackSignature(utf8ToBytes(RFC4231_TC2_DATA), RFC4231_TC2_KEY);
  assertEqual(digest, RFC4231_TC2_HMAC_SHA512, 'RFC 4231 §4.3 vector mismatch');
});

test('signature over a JSON body is a 128-char lowercase hex digest', async () => {
  const digest = await computePaystackSignature(utf8ToBytes(BODY), TEST_SECRET);
  assertEqual(digest.length, 128, 'SHA-512 hex length');
  assert(/^[0-9a-f]{128}$/.test(digest), 'digest must be lowercase hex');
});

test('correct signature verifies', async () => {
  const signature = await computePaystackSignature(utf8ToBytes(BODY), TEST_SECRET);
  const valid = await verifyPaystackSignature(utf8ToBytes(BODY), signature, TEST_SECRET);
  assertEqual(valid, true);
});

test('tampered body is rejected', async () => {
  const signature = await computePaystackSignature(utf8ToBytes(BODY), TEST_SECRET);
  const tampered = utf8ToBytes(BODY.replace('"amount":89900', '"amount":1'));
  const valid = await verifyPaystackSignature(tampered, signature, TEST_SECRET);
  assertEqual(valid, false);
});

test('wrong secret is rejected', async () => {
  const signature = await computePaystackSignature(utf8ToBytes(BODY), TEST_SECRET);
  const valid = await verifyPaystackSignature(utf8ToBytes(BODY), signature, 'sk_test_a_different_secret');
  assertEqual(valid, false);
});

test('missing header is rejected', async () => {
  const valid = await verifyPaystackSignature(utf8ToBytes(BODY), null, TEST_SECRET);
  assertEqual(valid, false);
});

test('short/malformed headers are rejected without throwing', async () => {
  const cases = ['', 'deadbeef', 'z'.repeat(128), 'g'.repeat(128), '0'.repeat(127), '0'.repeat(129)];
  for (const header of cases) {
    const valid = await verifyPaystackSignature(utf8ToBytes(BODY), header, TEST_SECRET);
    assertEqual(valid, false, `header "${header.slice(0, 12)}…" must be rejected`);
  }
});

test('uppercase signature header is accepted (normalised)', async () => {
  const signature = await computePaystackSignature(utf8ToBytes(BODY), TEST_SECRET);
  const valid = await verifyPaystackSignature(utf8ToBytes(BODY), signature.toUpperCase(), TEST_SECRET);
  assertEqual(valid, true);
});

test('surrounding whitespace in the header is tolerated', async () => {
  const signature = await computePaystackSignature(utf8ToBytes(BODY), TEST_SECRET);
  const valid = await verifyPaystackSignature(utf8ToBytes(BODY), `  ${signature}\n`, TEST_SECRET);
  assertEqual(valid, true);
});

test('raw byte differences (even same JSON content) change the signature', async () => {
  // Whitespace/key-order differences mean a re-serialised body must NOT
  // verify — this is exactly why handlers hash request.arrayBuffer().
  const canonical = JSON.stringify({a: 1, b: 2});
  const spaced = '{ "a": 1, "b": 2 }';
  const signature = await computePaystackSignature(utf8ToBytes(canonical), TEST_SECRET);
  const valid = await verifyPaystackSignature(utf8ToBytes(spaced), signature, TEST_SECRET);
  assertEqual(valid, false);
});
