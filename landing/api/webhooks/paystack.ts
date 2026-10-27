/**
 * POST /api/webhooks/paystack — signed, idempotent Paystack event intake.
 *
 * STATUS: signature verification + idempotency + event reduction are
 *         implemented and unit-tested locally (tests/signature.test.ts,
 *         tests/commerce-logic.test.ts). End-to-end delivery requires the
 *         commerce backend and a registered webhook URL, so the handler
 *         fails closed with 503 until configured. Not yet exercised against
 *         Paystack — a full test-mode delivery run is part of the checklist
 *         in docs/02-commerce-architecture.md.
 *
 * SECURITY
 *   - HMAC-SHA512 over the RAW request bytes (`x-paystack-signature`),
 *     constant-time compare — a modified body or wrong secret => 401,
 *   - payload size cap (1 MB),
 *   - dedupe_key UNIQUE => each provider event is processed exactly once,
 *   - every state change goes through the shared claim/reduce/apply
 *     pipeline (same as /api/verify), so access can never be granted twice
 *     for one payment,
 *   - responds 200 fast on duplicates (Paystack retries non-200s; see the
 *     retry matrix in api/README.md).
 *
 * Response policy:
 *   - bad signature        -> 401 (never processed),
 *   - unconfigured backend -> 503 (Paystack retries later; correct while
 *                             the system is not provisioned),
 *   - duplicate            -> 200,
 *   - applied / ignored    -> 200,
 *   - needs_attention      -> 200 (recorded as failed for manual review;
 *                             retries cannot fix a logical mismatch),
 *   - operational failure  -> 500 (event marked failed; Paystack retries).
 */

import {applyProviderEvent} from '../_lib/apply-reduction.ts';
import {loadReduceContext} from '../_lib/context.ts';
import {getCommerceConfig} from '../_lib/env.ts';
import type {ProviderEvent} from '../_lib/event-reducer.ts';
import {paystackDedupeKey} from '../_lib/event-reducer.ts';
import {apiError, json, methodGuard, notConfigured, sha256Hex} from '../_lib/http.ts';
import {verifyPaystackSignature} from '../_lib/paystack-signature.ts';
import type {Bytes} from '../_lib/codec.ts';

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const guard = methodGuard(request, 'POST');
  if (guard) return guard;

  const configResult = getCommerceConfig();
  if (!configResult.ok) return notConfigured(configResult.missing, configResult.invalid);
  const config = configResult.config;

  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return apiError(413, 'payload_too_large', 'Payload too large.');
  }

  // Exact bytes: the HMAC must cover precisely what the provider signed.
  let raw: Bytes;
  try {
    raw = new Uint8Array(await request.arrayBuffer());
  } catch {
    return apiError(400, 'invalid_body', 'Could not read the request body.');
  }
  if (raw.length === 0) {
    return apiError(400, 'invalid_body', 'Request body is empty.');
  }
  if (raw.length > MAX_WEBHOOK_BYTES) {
    return apiError(413, 'payload_too_large', 'Payload too large.');
  }

  const signature = request.headers.get('x-paystack-signature');
  const signatureValid = await verifyPaystackSignature(raw, signature, config.paystackWebhookSecret);
  if (!signatureValid) {
    console.warn('commerce: webhook rejected (invalid signature)');
    return apiError(401, 'invalid_signature', 'Signature verification failed.');
  }

  let parsed: {event?: unknown; data?: unknown};
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw)) as {event?: unknown; data?: unknown};
  } catch {
    return apiError(400, 'invalid_json', 'Payload is not valid JSON.');
  }
  if (
    typeof parsed.event !== 'string' ||
    parsed.event.length === 0 ||
    typeof parsed.data !== 'object' ||
    parsed.data === null ||
    Array.isArray(parsed.data)
  ) {
    return apiError(400, 'invalid_payload', 'Payload is missing event/data fields.');
  }

  const event: ProviderEvent = {type: parsed.event, data: parsed.data as Record<string, unknown>};
  const rawHash = await sha256Hex(raw);
  const dedupeKey = paystackDedupeKey(event, rawHash);

  try {
    const result = await applyProviderEvent(
      config,
      {dedupeKey, source: 'paystack_webhook', event, payload: parsed},
      (keys) => loadReduceContext(config, event, keys),
    );

    if (result.claim === 'duplicate') {
      return json({received: true, outcome: 'duplicate'});
    }
    return json({received: true, outcome: result.reduction?.outcome ?? 'unknown'});
  } catch (cause) {
    // Already marked `failed` inside applyProviderEvent so the retry works.
    console.error(`commerce: webhook processing failed: ${String(cause)}`);
    return apiError(500, 'processing_failed', 'Temporary processing failure; a retry is expected.');
  }
}
