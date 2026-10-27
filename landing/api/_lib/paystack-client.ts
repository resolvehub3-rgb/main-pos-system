/**
 * Server-side Paystack API client (test mode by default).
 *
 * MODE SAFETY: CommerceConfig refuses to load a `sk_live_...` key unless
 * ALLOW_LIVE_PAYMENTS=true, so every call made through this module uses test
 * credentials during preparation. No live credentials exist in this repo.
 *
 * All calls are server-side only: the secret key never reaches the browser.
 * Reference: https://paystack.com/docs/api/
 */

import type {CommerceConfig} from './env.ts';

const PAYSTACK_API_BASE = 'https://api.paystack.co';
const REQUEST_TIMEOUT_MS = 10_000;

export class PaystackError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PaystackError';
    this.status = status;
  }
}

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

async function paystackFetch<T>(
  config: CommerceConfig,
  path: string,
  init: {method: 'GET' | 'POST'; body?: unknown},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${PAYSTACK_API_BASE}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${config.paystackSecretKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new PaystackError(`paystack unreachable: ${String(cause)}`, 503);
  }

  const text = await response.text();
  let envelope: PaystackEnvelope<T> | null = null;
  try {
    envelope = JSON.parse(text) as PaystackEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || envelope === null || envelope.status !== true || envelope.data === undefined) {
    const detail = (envelope?.message ?? 'unexpected response').slice(0, 200);
    throw new PaystackError(
      `paystack ${init.method} ${path} failed (${response.status}): ${detail}`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }

  return envelope.data;
}

// ---------------------------------------------------------------------------
// transaction initialise
// ---------------------------------------------------------------------------

export interface InitializeInput {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export interface InitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

/**
 * Start a hosted Paystack checkout. The price comes from our database
 * (amountMinor) — the client never influences it.
 *
 * NOTE: no Paystack `plan` parameter is sent, i.e. this initialises a
 * ONE-TIME charge (prepaid access period). Attaching a Paystack plan would
 * enable card auto-renewal; that switch is an unresolved commercial decision
 * (docs/01-commercial-decisions.md) and is intentionally not wired up.
 */
export async function initializeTransaction(config: CommerceConfig, input: InitializeInput): Promise<InitializeResult> {
  const data = await paystackFetch<{
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  }>(config, '/transaction/initialize', {
    method: 'POST',
    body: {
      email: input.email,
      amount: input.amountMinor,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    },
  });

  if (data.reference !== input.reference) {
    throw new PaystackError('paystack returned a different reference', 502);
  }
  if (typeof data.authorization_url !== 'string') {
    throw new PaystackError('paystack returned no authorization url', 502);
  }

  let parsed: URL;
  try {
    parsed = new URL(data.authorization_url);
  } catch {
    throw new PaystackError('paystack returned an invalid authorization url', 502);
  }
  if (parsed.protocol !== 'https:') {
    throw new PaystackError('paystack authorization url must be https', 502);
  }

  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code ?? '',
    reference: input.reference,
  };
}

// ---------------------------------------------------------------------------
// transaction verify
// ---------------------------------------------------------------------------

export interface VerifiedTransaction {
  id: number;
  status: string;
  amount: number;
  currency: string;
  paidAt: string | null;
  reference: string;
  metadata: Record<string, unknown>;
}

/** Server-side lookup of the provider's view of a transaction. */
export async function verifyTransaction(config: CommerceConfig, reference: string): Promise<VerifiedTransaction> {
  const data = await paystackFetch<{
    id?: number;
    status?: string;
    amount?: number;
    currency?: string;
    paid_at?: string | null;
    reference?: string;
    metadata?: Record<string, unknown>;
  }>(config, `/transaction/verify/${encodeURIComponent(reference)}`, {method: 'GET'});

  if (
    typeof data.id !== 'number' ||
    typeof data.amount !== 'number' ||
    typeof data.currency !== 'string' ||
    typeof data.status !== 'string'
  ) {
    throw new PaystackError('paystack verify returned an unexpected payload', 502);
  }

  const metadata =
    typeof data.metadata === 'object' && data.metadata !== null ? data.metadata : {};

  return {
    id: data.id,
    status: data.status,
    amount: data.amount,
    currency: data.currency,
    paidAt: typeof data.paid_at === 'string' ? data.paid_at : null,
    reference: typeof data.reference === 'string' ? data.reference : reference,
    metadata,
  };
}
