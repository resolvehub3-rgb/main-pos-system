/**
 * Checkout flow client — published plans, checkout start, payment verification.
 *
 * Same rules across every endpoint:
 *  - the response of each server endpoint is mapped to a result the UI can
 *    render honestly (never a guessed success, never an invented URL),
 *  - classification is a pure function so every branch is unit-tested without
 *    a network,
 *  - nothing here can grant access or confirm a payment: the server decides,
 *    the browser only reports.
 *
 * Endpoints used:
 *   GET  /api/plans     → server-published prices (403 until PUBLISH_PRICES)
 *   POST /api/checkout  → {planCode} → Paystack hosted authorization URL
 *   POST /api/verify    → {reference} → server-verified payment + entitlement
 *
 * PRICE RULE: the browser never sends or computes a price. It sends a plan
 * `code` only; the server resolves the amount (api/_lib/plans.ts rejects any
 * price-like field outright).
 */

export interface PublishedPlan {
  code: string;
  name: string;
  amountMinor: number;
  currency: string;
  intervalMonths: number;
}

export interface EntitlementSummary {
  productCode: string;
  status: string;
  validFrom: string;
  validTo: string;
}

export type PlansFailureKind =
  | 'pricing_not_published'
  | 'not_configured'
  | 'backend_unavailable'
  | 'network'
  | 'invalid_response';

export type CheckoutFailureKind =
  | 'auth_required'
  | 'session_expired'
  | 'checkout_disabled'
  | 'plan_unavailable'
  | 'plan_not_found'
  | 'email_required'
  | 'rejected_client_price'
  | 'rate_limited'
  | 'paystack_unavailable'
  | 'not_configured'
  | 'network'
  | 'invalid_response'
  | 'backend_unavailable';

export type VerifyFailureKind =
  | 'auth_required'
  | 'session_expired'
  | 'reference_invalid'
  | 'order_not_found'
  | 'payment_pending'
  | 'payment_failed'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'metadata_mismatch'
  | 'needs_review'
  | 'not_configured'
  | 'rate_limited'
  | 'network'
  | 'retryable'
  | 'invalid_response';

export type PlansResult =
  | {ok: true; plans: PublishedPlan[]}
  | {ok: false; kind: PlansFailureKind; message: string; retryable: boolean};

export type CheckoutStartResult =
  | {ok: true; reference: string; authorizationUrl: string; plan: PublishedPlan}
  | {
      ok: false;
      kind: CheckoutFailureKind;
      message: string;
      retryable: boolean;
      retryAfterSeconds?: number;
    };

export type VerifyResult =
  | {
      ok: true;
      status: 'paid';
      reference: string;
      outcome: string;
      entitlement: EntitlementSummary | null;
    }
  | {
      ok: false;
      kind: VerifyFailureKind;
      message: string;
      retryable: boolean;
      retryAfterSeconds?: number;
      reference?: string;
    };

/** Convenience aliases for the failure branches the UI switches on. */
export type PlansFailure = Extract<PlansResult, {ok: false}>;
export type CheckoutFailure = Extract<CheckoutStartResult, {ok: false}>;
export type VerifyFailure = Extract<VerifyResult, {ok: false}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPlans(value: unknown): PublishedPlan[] | null {
  if (!isRecord(value) || !Array.isArray(value.plans)) return null;
  const plans: PublishedPlan[] = [];
  for (const entry of value.plans) {
    if (!isRecord(entry)) return null;
    const {code, name, amountMinor, currency, intervalMonths} = entry;
    if (
      typeof code !== 'string' ||
      typeof name !== 'string' ||
      typeof amountMinor !== 'number' ||
      typeof currency !== 'string' ||
      typeof intervalMonths !== 'number'
    ) {
      return null;
    }
    plans.push({code, name, amountMinor, currency, intervalMonths});
  }
  return plans;
}

function readEntitlement(value: unknown): EntitlementSummary | null {
  if (!isRecord(value)) return null;
  const {productCode, status, validFrom, validTo} = value;
  if (
    typeof productCode !== 'string' ||
    typeof status !== 'string' ||
    typeof validFrom !== 'string' ||
    typeof validTo !== 'string'
  ) {
    return null;
  }
  return {productCode, status, validFrom, validTo};
}

function readPlan(value: unknown): PublishedPlan | null {
  const list = readPlans({plans: [value]});
  return list ? list[0] : null;
}

function retryHeader(headers?: Headers | null): number | undefined {
  const raw = headers?.get('retry-after');
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

interface FailureExtra {
  retryable: boolean;
  retryAfterSeconds?: number;
  reference?: string;
}

interface FailureResult<K extends string> {
  ok: false;
  kind: K;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  reference?: string;
}

/**
 * Build a failure result. `K` is inferred as a literal, so passing a kind that
 * does not exist in the matching result union is a compile error.
 */
function failure<K extends string>(
  kind: K,
  message: string,
  extra: FailureExtra = {retryable: false},
): FailureResult<K> {
  return {
    ok: false,
    kind,
    message,
    retryable: extra.retryable,
    ...(extra.retryAfterSeconds !== undefined
      ? {retryAfterSeconds: extra.retryAfterSeconds}
      : {}),
    ...(extra.reference !== undefined ? {reference: extra.reference} : {}),
  };
}

// ---------------------------------------------------------------------------
// GET /api/plans
// ---------------------------------------------------------------------------

/** Map one GET /api/plans response to a PlansResult. Pure; unit-tested. */
export function classifyPlansResponse(status: number, body: unknown): PlansResult {
  const record = isRecord(body) ? body : {};
  const code = typeof record.error === 'string' ? record.error : '';
  const serverMessage = typeof record.message === 'string' ? record.message : '';

  if (status === 200) {
    const plans = readPlans(record);
    if (!plans) {
      return failure('invalid_response', 'The price list came back in an unexpected format.', {
        retryable: true,
      });
    }
    return {ok: true, plans};
  }
  if (code === 'pricing_not_approved' || status === 403) {
    return {
      ok: false,
      kind: 'pricing_not_published',
      message: serverMessage || 'Prices are not published yet. Please enquire for current pricing.',
      retryable: false,
    };
  }
  if (status === 503) {
    return {
      ok: false,
      kind: code === 'commerce_not_configured' ? 'not_configured' : 'backend_unavailable',
      message:
        code === 'commerce_not_configured'
          ? 'Prices are not available on this deployment yet.'
          : serverMessage,
      retryable: false,
    };
  }
  return failure('backend_unavailable', serverMessage || 'Could not load prices right now.', {
    retryable: true,
  });
}

export interface PlansRequestOptions {
  /** '' = same origin (normal Vercel setup); otherwise the API origin. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export async function fetchPublishedPlans(
  options: PlansRequestOptions = {},
): Promise<PlansResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${(options.apiBase ?? '').replace(/\/+$/, '')}/api/plans`;
  let response: Response;
  try {
    response = await fetchImpl(url, {cache: 'no-store'});
  } catch {
    return failure('network', 'Could not reach the price service. Check your connection.', {
      retryable: true,
    });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return classifyPlansResponse(response.status, body);
}

// ---------------------------------------------------------------------------
// POST /api/checkout
// ---------------------------------------------------------------------------

/** Map one POST /api/checkout response. Pure; unit-tested. */
export function classifyCheckoutResponse(
  status: number,
  body: unknown,
  retryAfterSeconds?: number,
): CheckoutStartResult {
  const record = isRecord(body) ? body : {};
  const code = typeof record.error === 'string' ? record.error : '';
  const serverMessage = typeof record.message === 'string' ? record.message : '';

  if (status === 200) {
    const reference = typeof record.reference === 'string' ? record.reference : '';
    const authorizationUrl = typeof record.authorizationUrl === 'string' ? record.authorizationUrl : '';
    const plan = readPlan(record.plan);
    if (reference === '' || authorizationUrl === '' || !plan) {
      return failure('invalid_response', 'The checkout service returned an unexpected answer.', {
        retryable: true,
      });
    }
    return {ok: true, reference, authorizationUrl, plan};
  }

  if (status === 401) {
    const kind = code === 'invalid_session' ? 'session_expired' : 'auth_required';
    return failure(
      kind,
      serverMessage ||
        (kind === 'session_expired'
          ? 'Your session has expired. Sign in again to continue.'
          : 'Sign in with your SamTill account to buy a licence.'),
    );
  }

  if (status === 503) {
    if (code === 'checkout_disabled') {
      return failure('checkout_disabled', serverMessage, {retryable: false});
    }
    return failure('not_configured', serverMessage, {retryable: false});
  }

  if (status === 400) {
    if (code === 'plan_not_found') {
      return failure('plan_not_found', serverMessage, {retryable: false});
    }
    if (code === 'plan_required' || code === 'plan_inactive') {
      return failure('plan_unavailable', serverMessage, {retryable: false});
    }
    if (code === 'client_price_not_allowed') {
      return failure('rejected_client_price', serverMessage, {retryable: false});
    }
    if (code === 'email_required') {
      return failure('email_required', serverMessage, {retryable: false});
    }
    return failure('plan_unavailable', serverMessage || 'Checkout could not start.', {
      retryable: false,
    });
  }

  if (status === 429) {
    return failure('rate_limited', serverMessage, {
      retryable: true,
      ...(retryAfterSeconds !== undefined ? {retryAfterSeconds} : {}),
    });
  }

  if (status === 502) {
    if (code === 'paystack_unavailable') {
      return failure('paystack_unavailable', serverMessage, {retryable: true});
    }
    return failure('backend_unavailable', serverMessage, {retryable: true});
  }

  return failure('backend_unavailable', serverMessage || 'Could not start checkout.', {
    retryable: true,
  });
}

export interface CheckoutRequestOptions {
  apiBase?: string;
  accessToken: string;
  planCode: string;
  fetchImpl?: typeof fetch;
}

/**
 * Ask the server to start a hosted Paystack checkout for a plan code.
 * Throws nothing: any network failure becomes a `network` result.
 */
export async function startCheckout(
  options: CheckoutRequestOptions,
): Promise<CheckoutStartResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${(options.apiBase ?? '').replace(/\/+$/, '')}/api/checkout`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.accessToken}`,
      },
      body: JSON.stringify({planCode: options.planCode}),
      cache: 'no-store',
    });
  } catch {
    return failure('network', 'Could not reach the checkout service. Check your connection and try again.', {
      retryable: true,
    });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return classifyCheckoutResponse(response.status, body, retryHeader(response.headers));
}

// ---------------------------------------------------------------------------
// POST /api/verify
// ---------------------------------------------------------------------------

/** Map one POST /api/verify response. Pure; unit-tested. */
export function classifyVerifyResponse(
  status: number,
  body: unknown,
  retryAfterSeconds?: number,
): VerifyResult {
  const record = isRecord(body) ? body : {};
  const code = typeof record.error === 'string' ? record.error : '';
  const serverMessage = typeof record.message === 'string' ? record.message : '';
  const reference = typeof record.reference === 'string' ? record.reference : undefined;

  if (status === 200) {
    const statusValue = typeof record.status === 'string' ? record.status : '';
    if (statusValue !== 'paid') {
      return failure('invalid_response', 'The payment service returned an unexpected answer.', {
        retryable: true,
      });
    }
    return {
      ok: true,
      status: 'paid',
      reference: typeof record.reference === 'string' ? record.reference : '',
      outcome: typeof record.outcome === 'string' ? record.outcome : 'unknown',
      entitlement: readEntitlement(record.entitlement),
    };
  }

  if (status === 401) {
    const kind = code === 'invalid_session' ? 'session_expired' : 'auth_required';
    return failure(kind, serverMessage, {
      retryable: false,
      ...(reference !== undefined ? {reference} : {}),
    });
  }

  if (status === 400) {
    return failure('reference_invalid', serverMessage || 'That payment reference is not valid.', {
      retryable: false,
      ...(reference !== undefined ? {reference} : {}),
    });
  }

  if (status === 404) {
    return failure(
      'order_not_found',
      serverMessage || 'No payment found for that reference. If you were charged, contact support with your reference.',
      {retryable: false},
    );
  }

  if (status === 402) {
    // Paystack reported a non-success state (pending / abandoned / failed).
    // Not auto-retried: the customer decides whether to check again.
    return failure('payment_pending', serverMessage, {
      retryable: false,
      ...(reference !== undefined ? {reference} : {}),
    });
  }

  if (status === 409) {
    if (code === 'payment_recording_needs_review') {
      return failure('needs_review', serverMessage, {
        retryable: false,
        ...(reference !== undefined ? {reference} : {}),
      });
    }
    if (code === 'amount_mismatch') {
      return failure('amount_mismatch', serverMessage, {retryable: false});
    }
    if (code === 'currency_mismatch') {
      return failure('currency_mismatch', serverMessage, {retryable: false});
    }
    return failure('metadata_mismatch', serverMessage, {retryable: false});
  }

  if (status === 429) {
    return failure('rate_limited', serverMessage, {
      retryable: true,
      ...(retryAfterSeconds !== undefined ? {retryAfterSeconds} : {}),
    });
  }

  if (status === 503) {
    return failure('not_configured', serverMessage, {retryable: false});
  }

  if (status === 502) {
    // verification_unavailable / recording_failed / recording_in_progress —
    // the webhook may simply not have landed yet, so retrying helps.
    return failure('retryable', serverMessage || 'Could not confirm the payment yet.', {
      retryable: true,
      ...(reference !== undefined ? {reference} : {}),
    });
  }

  return failure('retryable', serverMessage || 'Could not confirm the payment.', {
    retryable: true,
    ...(reference !== undefined ? {reference} : {}),
  });
}

export interface VerifyRequestOptions {
  apiBase?: string;
  accessToken: string;
  reference: string;
  fetchImpl?: typeof fetch;
}

export async function verifyPayment(options: VerifyRequestOptions): Promise<VerifyResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${(options.apiBase ?? '').replace(/\/+$/, '')}/api/verify`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.accessToken}`,
      },
      body: JSON.stringify({reference: options.reference}),
      cache: 'no-store',
    });
  } catch {
    return failure('network', 'Could not reach the payment service. Check your connection.', {
      retryable: true,
      reference: options.reference,
    });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return classifyVerifyResponse(response.status, body, retryHeader(response.headers));
}

export interface VerifyRetryOptions extends VerifyRequestOptions {
  /** Delay between attempts, in ms. Default: [0, 1500, 3000, 6000]. */
  delaysMs?: number[];
  /** Injectable for tests; defaults to a real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Verify a payment, retrying only while the server says retrying can help.
 *
 * The webhook that confirms a payment can arrive a beat after the customer
 * returns from Paystack, so the first verify sometimes sees the payment still
 * being recorded. This retries a few times with growing gaps and stops
 * immediately on any definitive answer (paid, failed, needs review, rate
 * limited). It never converts a failure into a success.
 */
export async function verifyWithBackoff(options: VerifyRetryOptions): Promise<VerifyResult> {
  const delays = options.delaysMs ?? [0, 1500, 3000, 6000];
  const sleep = options.sleep ?? defaultSleep;
  let last: VerifyResult = failure('retryable', 'Could not confirm the payment.', {
    retryable: true,
  });

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
    last = await verifyPayment(options);
    if (last.ok || !last.retryable) return last;
  }
  return last;
}

// ---------------------------------------------------------------------------
// GET /api/subscription — the customer's licence state
// ---------------------------------------------------------------------------

export interface AccessEntitlement {
  productCode: string;
  status: string;
  planCode: string | null;
  validFrom: string;
  validTo: string;
}

export type AccessResult =
  | {ok: true; entitlements: AccessEntitlement[]}
  | {ok: false; kind: 'auth_required' | 'session_expired' | 'not_configured' | 'network' | 'backend_unavailable' | 'invalid_response'; message: string; retryable: boolean};

/** Map one GET /api/subscription response. Pure; unit-tested. */
export function classifyAccessResponse(status: number, body: unknown): AccessResult {
  const record = isRecord(body) ? body : {};
  const code = typeof record.error === 'string' ? record.error : '';
  const serverMessage = typeof record.message === 'string' ? record.message : '';

  if (status === 200) {
    if (!Array.isArray(record.entitlements)) {
      return failure('invalid_response', 'The account service returned an unexpected answer.', {
        retryable: true,
      });
    }
    const entitlements: AccessEntitlement[] = [];
    for (const entry of record.entitlements) {
      if (!isRecord(entry)) continue;
      const {productCode, status: entryStatus, planCode, validFrom, validTo} = entry;
      if (
        typeof productCode !== 'string' ||
        typeof entryStatus !== 'string' ||
        typeof validFrom !== 'string' ||
        typeof validTo !== 'string'
      ) {
        continue;
      }
      entitlements.push({
        productCode,
        status: entryStatus,
        planCode: typeof planCode === 'string' ? planCode : null,
        validFrom,
        validTo,
      });
    }
    return {ok: true, entitlements};
  }

  if (status === 401) {
    const kind = code === 'invalid_session' ? 'session_expired' : 'auth_required';
    return failure(kind, serverMessage);
  }
  if (status === 503) {
    return failure('not_configured', serverMessage, {retryable: false});
  }
  return failure('backend_unavailable', serverMessage || 'Could not load your licence right now.', {
    retryable: true,
  });
}

export interface AccessRequestOptions {
  apiBase?: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export async function fetchMyAccess(options: AccessRequestOptions): Promise<AccessResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${(options.apiBase ?? '').replace(/\/+$/, '')}/api/subscription`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {authorization: `Bearer ${options.accessToken}`},
      cache: 'no-store',
    });
  } catch {
    return failure('network', 'Could not reach the account service. Check your connection.', {
      retryable: true,
    });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return classifyAccessResponse(response.status, body);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  GHS: 'GH₵',
  NGN: '₦',
  USD: '$',
};

/**
 * Format a minor-unit amount for display: 49900 GHS → 'GH₵499'.
 * The value is display only — never sent to checkout.
 */
export function formatMinorAmount(amountMinor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  const major = amountMinor / 100;
  const hasFraction = !Number.isInteger(major);
  return `${symbol}${major.toLocaleString('en-GH', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Human message for a failed startCheckout, used when a server message is absent. */
export function checkoutFailureMessage(kind: CheckoutFailureKind): string {
  switch (kind) {
    case 'checkout_disabled':
      return 'Online checkout is not open yet. Please enquire to purchase.';
    case 'paystack_unavailable':
      return 'The payment provider is unavailable right now. Please try again shortly.';
    case 'rate_limited':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'network':
      return 'Could not reach the checkout service. Check your connection and try again.';
    default:
      return 'Could not start checkout right now. Please try again shortly.';
  }
}
