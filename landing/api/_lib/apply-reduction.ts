/**
 * Orchestration: claim (dedupe) -> reduce (pure) -> apply (DB patches).
 *
 * Used by BOTH /api/webhooks/paystack and /api/verify so the two paths can
 * never disagree about how an event changes local state.
 *
 * Sequence per event:
 *   1. CLAIM   — look up dedupe_key in webhook_events:
 *        - row exists, status processed/received -> `duplicate`, stop,
 *        - row exists, status failed             -> `retry` (reprocess),
 *        - no row -> insert `received` (unique violation -> `duplicate`),
 *   2. LOAD    — the caller loads order/entitlement/subscription/plan rows
 *                relevant to the event (see each endpoint),
 *   3. REDUCE  — pure decision (event-reducer.ts),
 *   4. APPLY   — write patches. The order patch is conditional
 *                (`status=eq.pending`): if zero rows update, another path
 *                already applied this payment and the entitlement patch is
 *                skipped — the second writer never double-extends,
 *   5. MARK    — webhook_events.status = processed, plus an audit row.
 *
 * FAILURE SEMANTICS (see api/README.md):
 *   - operational error (network/DB)  -> throws; caller marks the event
 *     `failed` and (for webhooks) answers 500 so the provider retries,
 *   - logical non-application (amount mismatch, unknown reference) ->
 *     recorded as `failed` with notes but the webhook still answers 200,
 *     because retries cannot fix a logical mismatch; it stays visible for
 *     manual review instead of hammering the endpoint.
 */

import type {CommerceConfig} from './env.ts';
import {writeAudit} from './audit.ts';
import {
  extractEventKeys,
  reducePaystackEvent,
  type EventKeys,
  type ProviderEvent,
  type ReduceContext,
  type Reduction,
} from './event-reducer.ts';
import {BackendError, insertRow, selectRows, updateRows} from './supabase.ts';

export type ClaimOutcome = 'new' | 'retry' | 'duplicate';

interface EventRecordRow {
  id: string;
  status: 'received' | 'processed' | 'failed';
  received_at: string;
}

/**
 * A `received` row younger than this is assumed to be processed by a
 * concurrent delivery (answer duplicate); older than this, the previous
 * attempt most likely crashed mid-processing and is retried.
 */
const IN_FLIGHT_GRACE_MS = 5 * 60 * 1000;

export interface ApplyInput {
  dedupeKey: string;
  source: 'paystack_webhook' | 'transaction_verify';
  event: ProviderEvent;
  /** JSON-serialisable payload stored for audit/forensics. */
  payload: unknown;
}

export interface ApplyResult {
  claim: ClaimOutcome;
  reduction: Reduction | null;
}

export type ContextLoader = (keys: EventKeys) => Promise<ReduceContext>;

function escapeEq(value: string): string {
  return encodeURIComponent(value);
}

async function claimEvent(config: CommerceConfig, input: ApplyInput): Promise<ClaimOutcome> {
  const existing = await selectRows<EventRecordRow>(
    config,
    'webhook_events',
    `dedupe_key=eq.${escapeEq(input.dedupeKey)}&select=id,status,received_at&limit=1`,
  );

  if (existing.length > 0) {
    const row = existing[0];
    const receivedMs = Date.parse(row.received_at);
    const stalled =
      row.status === 'failed' ||
      (row.status === 'received' &&
        (Number.isNaN(receivedMs) || Date.now() - receivedMs > IN_FLIGHT_GRACE_MS));

    if (stalled) {
      // Previous attempt failed or crashed mid-processing — allow a retry.
      await updateRows(
        config,
        'webhook_events',
        `dedupe_key=eq.${escapeEq(input.dedupeKey)}`,
        {status: 'received', failure_reason: null, received_at: new Date().toISOString()},
      );
      return 'retry';
    }
    // Fresh `received` (concurrent delivery in flight) or `processed`.
    return 'duplicate';
  }

  try {
    await insertRow(
      config,
      'webhook_events',
      {
        dedupe_key: input.dedupeKey,
        event_type: input.event.type,
        source: input.source,
        status: 'received',
        payload: input.payload,
      },
    );
    return 'new';
  } catch (cause) {
    // Unique violation on dedupe_key: a concurrent delivery won the race.
    if (cause instanceof BackendError && cause.status === 409) {
      return 'duplicate';
    }
    throw cause;
  }
}

async function markEventProcessed(config: CommerceConfig, dedupeKey: string): Promise<void> {
  await updateRows(config, 'webhook_events', `dedupe_key=eq.${escapeEq(dedupeKey)}`, {
    status: 'processed',
    processed_at: new Date().toISOString(),
    failure_reason: null,
  });
}

/** Best-effort: used from catch blocks, must not throw. */
export async function markEventFailed(config: CommerceConfig, dedupeKey: string, reason: string): Promise<void> {
  try {
    await updateRows(config, 'webhook_events', `dedupe_key=eq.${escapeEq(dedupeKey)}`, {
      status: 'failed',
      failure_reason: reason.slice(0, 500),
    });
  } catch (cause) {
    console.error(`commerce: could not mark event failed (${dedupeKey}): ${String(cause)}`);
  }
}

interface ApplyOutcome {
  /** False when another writer already applied this payment (lost race). */
  applied: boolean;
}

async function applyPatches(
  config: CommerceConfig,
  context: ReduceContext,
  reduction: Reduction,
): Promise<ApplyOutcome> {
  // Guard 2 of the idempotency model: only a pending order can flip to paid.
  if (reduction.orderAction === 'update' && reduction.orderPatch !== null && context.order !== null) {
    const updated = await updateRows(
      config,
      'orders',
      `reference=eq.${escapeEq(context.order.reference)}&status=eq.pending`,
      reduction.orderPatch,
    );
    if (updated.length === 0) {
      return {applied: false};
    }
  }

  if (reduction.entitlementAction === 'create' && reduction.entitlementPatch !== null) {
    await insertRow(config, 'entitlements', reduction.entitlementPatch);
  } else if (
    reduction.entitlementAction === 'update' &&
    reduction.entitlementPatch !== null &&
    context.entitlement !== null
  ) {
    await updateRows(config, 'entitlements', `id=eq.${escapeEq(context.entitlement.id)}`, reduction.entitlementPatch);
  }

  if (reduction.subscriptionAction === 'create' && reduction.subscriptionPatch !== null) {
    await insertRow(config, 'subscriptions', reduction.subscriptionPatch);
  } else if (
    reduction.subscriptionAction === 'update' &&
    reduction.subscriptionPatch !== null &&
    context.subscription !== null
  ) {
    await updateRows(
      config,
      'subscriptions',
      `id=eq.${escapeEq(context.subscription.id)}`,
      reduction.subscriptionPatch,
    );
  }

  return {applied: true};
}

/**
 * Full claim/reduce/apply pipeline for one provider event.
 * Throws on operational failures; callers handle marking + HTTP status.
 */
export async function applyProviderEvent(
  config: CommerceConfig,
  input: ApplyInput,
  loadContext: ContextLoader,
): Promise<ApplyResult> {
  const claim = await claimEvent(config, input);
  if (claim === 'duplicate') {
    return {claim, reduction: null};
  }

  try {
    const keys = extractEventKeys(input.event);
    const context = await loadContext(keys);
    const reduction = reducePaystackEvent(context);

    if (reduction.outcome === 'duplicate' || reduction.outcome === 'ignored') {
      await markEventProcessed(config, input.dedupeKey);
      return {claim, reduction};
    }

    if (reduction.outcome === 'needs_attention') {
      // Logical mismatch: recorded for manual review, not retryable by the
      // provider. The row is marked failed so a human replay can reprocess.
      await markEventFailed(config, input.dedupeKey, reduction.notes.join('; '));
      await writeAudit(config, {
        action: `${input.source}_needs_attention`,
        entity: 'webhook_event',
        entityId: input.dedupeKey,
        metadata: {event_type: input.event.type, notes: reduction.notes},
      });
      return {claim, reduction};
    }

    // outcome === 'applied'
    const {applied} = await applyPatches(config, context, reduction);
    if (!applied) {
      reduction.outcome = 'duplicate';
      reduction.notes.push('lost_race_order_already_applied');
    }

    await markEventProcessed(config, input.dedupeKey);
    await writeAudit(config, {
      action: `${input.source}_${reduction.outcome}`,
      entity: 'webhook_event',
      entityId: input.dedupeKey,
      metadata: {
        event_type: input.event.type,
        outcome: reduction.outcome,
        notes: reduction.notes,
        order_reference: context.order?.reference ?? null,
      },
    });

    return {claim, reduction};
  } catch (cause) {
    // Operational failure after the claim: mark `failed` so the provider
    // retry (or a client retry for /api/verify) reprocesses instead of
    // being answered `duplicate` forever.
    await markEventFailed(config, input.dedupeKey, String(cause));
    throw cause;
  }
}
