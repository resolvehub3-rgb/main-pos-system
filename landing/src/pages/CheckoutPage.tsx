import {useEffect, useRef, useState} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import {COMMERCE} from '../config/commerce';
import {SUBSCRIPTION_PLAN, SUBSCRIPTION_TERMS} from '../config/pricing';
import {checkoutAvailability} from '../lib/availability';
import {readCommerceEnv} from '../lib/commerceClient';
import {
  checkoutFailureMessage,
  fetchPublishedPlans,
  formatMinorAmount,
  startCheckout,
  verifyWithBackoff,
  type CheckoutFailure,
  type PlansFailure,
  type PublishedPlan,
  type VerifyResult,
} from '../lib/checkoutClient';
import {navigateMarketing} from '../lib/marketingRoute';
import {loginHref, navigateTo} from '../lib/navigation';
import {useAccountSession} from '../lib/useAccountSession';
import {useHashRoute} from '../lib/useHashRoute';

/**
 * Complete and verify the single SamTill POS 6-Month Subscription payment.
 *
 * Flow:
 *   1. `#/checkout?plan=samtill-pos-6m` -> review the server-published price
 *      (GH₵500.00 / 6 Months), click "PAY NOW" -> hosted Paystack checkout;
 *   2. Paystack redirects back to `/?checkout=return&reference=…`
 *      (App.tsx forwards that to `#/checkout?reference=…`),
 *   3. Server verifies via POST /api/verify (with backoff for webhook arrival),
 *      records the payment, activates the 6-month subscription, stores the
 *      start date, and sets expiry 6 calendar months from activation.
 */

const PLAN_KEY = 'samtill_checkout_plan';

type PlansState =
  | {status: 'loading'}
  | {status: 'ready'; plans: PublishedPlan[]}
  | {status: 'failed'; failure: PlansFailure};

type VerifyState =
  | {status: 'idle'}
  | {status: 'running'}
  | {status: 'done'; result: VerifyResult};

function bannerToneFor(kind: string): BannerTone {
  if (kind === 'needs_review' || kind === 'rate_limited' || kind === 'payment_pending') {
    return 'info';
  }
  return 'error';
}

function formatDisplayDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function CheckoutPage() {
  const apiBase = readCommerceEnv().apiBase;
  const availability = checkoutAvailability(COMMERCE, readCommerceEnv());
  const route = useHashRoute();
  const {loading, account, signOut} = useAccountSession();

  const reference = route.params.get('reference') ?? route.params.get('trxref') ?? '';
  const planParam = route.params.get('plan') ?? '';

  const [plansState, setPlansState] = useState<PlansState>({status: 'loading'});
  const [selected, setSelected] = useState<string>(SUBSCRIPTION_PLAN.id);
  const [starting, setStarting] = useState(false);
  const [startFailure, setStartFailure] = useState<CheckoutFailure | null>(null);
  const [verifyState, setVerifyState] = useState<VerifyState>({status: 'idle'});

  const plansRequested = useRef(false);
  const verifyStarted = useRef('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const chosen = planParam || window.sessionStorage.getItem(PLAN_KEY) || SUBSCRIPTION_PLAN.id;
    const canonical = chosen === SUBSCRIPTION_PLAN.id ? SUBSCRIPTION_PLAN.id : chosen;
    setSelected(canonical);
    window.sessionStorage.setItem(PLAN_KEY, canonical);
  }, [planParam]);

  // Price list: public endpoint, fetched once when checkout is available.
  useEffect(() => {
    if (!availability.available || plansRequested.current) return;
    plansRequested.current = true;
    void fetchPublishedPlans({apiBase}).then((result) => {
      if (!mounted.current) return;
      if (result.ok) setPlansState({status: 'ready', plans: result.plans});
      else setPlansState({status: 'failed', failure: result});
    });
  }, [apiBase, availability.available]);

  // Returning from Paystack: verify the reference with backoff until verified or definitively settled.
  useEffect(() => {
    if (!reference || !account || verifyState.status !== 'idle') return;
    if (verifyStarted.current === reference) return;
    verifyStarted.current = reference;
    setVerifyState({status: 'running'});
    const token = account.accessToken;
    void verifyWithBackoff({apiBase, accessToken: token, reference}).then((result) => {
      if (!mounted.current) return;
      setVerifyState({status: 'done', result});
    });
  }, [reference, account, verifyState.status, apiBase]);

  const fallbackPrice = formatMinorAmount(SUBSCRIPTION_PLAN.amountMinor, SUBSCRIPTION_PLAN.currencyCode);

  async function handleBuy(planCodeToCharge: string) {
    if (!account) return;
    setStartFailure(null);
    setStarting(true);
    const result = await startCheckout({
      apiBase,
      accessToken: account.accessToken,
      planCode: planCodeToCharge,
    });
    if (result.ok) {
      window.sessionStorage.setItem(PLAN_KEY, result.plan.code);
      window.location.assign(result.authorizationUrl);
      return;
    }
    setStartFailure(result);
    setStarting(false);
  }

  function handleCheckAgain() {
    if (!reference) return;
    verifyStarted.current = '';
    setVerifyState({status: 'idle'});
  }

  function handleRetryCheckout() {
    verifyStarted.current = '';
    setVerifyState({status: 'idle'});
    setStartFailure(null);
    navigateTo(`/checkout?plan=${SUBSCRIPTION_PLAN.id}`);
  }

  const backToPricingLink = (
    <a
      href="/pricing"
      onClick={(event) => {
        event.preventDefault();
        navigateMarketing('/pricing');
      }}
      className="font-semibold text-navy-700 underline-offset-4 hover:underline"
    >
      ← Back to Pricing
    </a>
  );

  // ---- gates -------------------------------------------------------------

  if (!availability.available) {
    return (
      <AccountShell
        title={`${SUBSCRIPTION_PLAN.productName} — ${SUBSCRIPTION_PLAN.name}`}
        subtitle={`${fallbackPrice} · ${SUBSCRIPTION_PLAN.durationLabel} · ${SUBSCRIPTION_PLAN.paymentType}`}
        footer={backToPricingLink}
      >
        <dl className="mb-5 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-bold text-navy-900">Subscription</dt>
            <dd className="text-navy-700">{SUBSCRIPTION_PLAN.name}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-bold text-navy-900">Amount</dt>
            <dd className="text-lg font-extrabold text-navy-900">{fallbackPrice}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-bold text-navy-900">Duration</dt>
            <dd className="text-navy-700">{SUBSCRIPTION_PLAN.durationLabel}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-bold text-navy-900">Payment type</dt>
            <dd className="text-navy-700">{SUBSCRIPTION_PLAN.paymentType}</dd>
          </div>
        </dl>
        <GateNotice notice={availability.notice} actionHref="/pricing" actionLabel="Back to Pricing" />
      </AccountShell>
    );
  }

  if (loading) {
    return (
      <AccountShell title={`${SUBSCRIPTION_PLAN.productName} — ${SUBSCRIPTION_PLAN.name}`} subtitle="Secure online payment">
        <p className="text-sm text-navy-700" role="status">
          Checking your session…
        </p>
      </AccountShell>
    );
  }

  // ---- returning from Paystack ------------------------------------------

  if (reference) {
    if (!account) {
      return (
        <AccountShell
          title="Confirm your payment"
          subtitle="Secure online payment"
          footer={
            <a href="#/register?next=checkout" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
              Create an account →
            </a>
          }
        >
          <GateNotice
            notice="Sign in with the account you used to pay so we can verify your payment and activate your 6-Month Subscription."
            actionHref={loginHref('/checkout')}
            actionLabel="Sign in"
          />
        </AccountShell>
      );
    }

    if (verifyState.status === 'running' || verifyState.status === 'idle') {
      return (
        <AccountShell title="Confirming your payment" subtitle="Verifying with Paystack">
          <div className="flex items-start gap-3 text-sm text-navy-700" role="status">
            <span className="mt-0.5 inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-navy-300 border-t-amber-600" />
            <p>
              Verifying your {fallbackPrice} payment with Paystack… please keep this page open.
              <span className="mt-2 block font-mono text-xs text-slate-500">
                Reference: {reference}
              </span>
            </p>
          </div>
        </AccountShell>
      );
    }

    const result = verifyState.result;
    if (result.ok) {
      const entitlement = result.entitlement;
      const subscription = result.subscription;
      const startIso = subscription?.currentPeriodStart ?? entitlement?.validFrom ?? null;
      const endIso = subscription?.currentPeriodEnd ?? entitlement?.validTo ?? null;

      return (
        <AccountShell
          title="Subscription activated"
          subtitle={`Your ${SUBSCRIPTION_PLAN.productName} ${SUBSCRIPTION_PLAN.name} is active.`}
          footer={
            <a href="#/account" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
              View my account →
            </a>
          }
        >
          <StatusBanner tone="success">
            Payment of {fallbackPrice} confirmed. Your 6-Month Subscription for {SUBSCRIPTION_PLAN.productName} is now active.
          </StatusBanner>

          <dl className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-bold text-navy-900">Subscription</dt>
              <dd className="text-navy-700">{SUBSCRIPTION_PLAN.name}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-bold text-navy-900">Duration</dt>
              <dd className="text-navy-700">{SUBSCRIPTION_PLAN.durationLabel}</dd>
            </div>
            {startIso && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="font-bold text-navy-900">Start date</dt>
                <dd className="text-navy-700">{formatDisplayDate(startIso)}</dd>
              </div>
            )}
            {endIso && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="font-bold text-navy-900">Expiry date</dt>
                <dd className="font-bold text-emerald-800">{formatDisplayDate(endIso)}</dd>
              </div>
            )}
            <div>
              <dt className="font-bold text-navy-900">Payment reference</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-navy-700">
                {result.reference}
              </dd>
            </div>
          </dl>

          <a
            href="/app/login"
            className="mt-5 block w-full rounded-full bg-amber-700 px-6 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Open SamTill POS →
          </a>

          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Access runs for six calendar months from activation. Keep the payment reference above
            for your records.
          </p>
        </AccountShell>
      );
    }

    // ---- verify failed / cancelled / pending ----------------------------
    const failure = result;
    const isCancelled = failure.kind === 'payment_cancelled';
    const isFailed = failure.kind === 'payment_failed';

    return (
      <AccountShell
        title={isCancelled ? 'Payment cancelled' : 'Payment verification'}
        subtitle="Secure online payment"
        footer={backToPricingLink}
      >
        <StatusBanner tone={bannerToneFor(failure.kind)}>
          {failure.message ||
            (isCancelled
              ? 'Payment was cancelled before completion. You have not been charged.'
              : 'We could not confirm this payment yet.')}
        </StatusBanner>

        {failure.kind === 'needs_review' && (
          <p className="mt-3 text-sm leading-relaxed text-navy-700">
            Your payment was received but needs a manual check. Send us this reference so we can
            activate your subscription: <strong className="font-mono">{reference}</strong>
          </p>
        )}

        {(failure.kind === 'amount_mismatch' ||
          failure.kind === 'currency_mismatch' ||
          failure.kind === 'metadata_mismatch') && (
          <p className="mt-3 text-sm leading-relaxed text-navy-700">
            The payment details returned did not match this subscription order. Please reference{' '}
            <strong className="font-mono">{reference}</strong> if you were debited.
          </p>
        )}

        {failure.kind === 'order_not_found' && (
          <p className="mt-3 text-sm leading-relaxed text-navy-700">
            No matching subscription order was found for reference{' '}
            <strong className="font-mono">{reference}</strong>.
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {(isCancelled || isFailed) && (
            <button
              type="button"
              onClick={handleRetryCheckout}
              className="inline-flex flex-1 items-center justify-center rounded-full bg-amber-700 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-800"
            >
              Retry payment ({fallbackPrice})
            </button>
          )}
          {(failure.kind === 'payment_pending' || failure.retryable || failure.kind === 'network') && (
            <button
              type="button"
              onClick={handleCheckAgain}
              className="inline-flex flex-1 items-center justify-center rounded-full bg-navy-900 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-navy-800"
            >
              Check status again
              {'retryAfterSeconds' in failure && failure.retryAfterSeconds
                ? ` (~${failure.retryAfterSeconds}s)`
                : ''}
            </button>
          )}
          {failure.kind === 'auth_required' || failure.kind === 'session_expired' ? (
            <a
              href={loginHref('/checkout')}
              className="inline-flex flex-1 items-center justify-center rounded-full bg-amber-700 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-800"
            >
              Sign in again →
            </a>
          ) : null}
        </div>
      </AccountShell>
    );
  }

  // ---- not signed in -----------------------------------------------------

  if (!account) {
    return (
      <AccountShell
        title={`${SUBSCRIPTION_PLAN.productName} — ${SUBSCRIPTION_PLAN.name}`}
        subtitle={`${fallbackPrice} · ${SUBSCRIPTION_PLAN.durationLabel} · ${SUBSCRIPTION_PLAN.paymentType}`}
        footer={
          <a href="#/register?next=checkout" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
            Create an account →
          </a>
        }
      >
        <dl className="mb-5 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-bold text-navy-900">Subscription</dt>
            <dd className="text-navy-700">{SUBSCRIPTION_PLAN.name}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-bold text-navy-900">Price</dt>
            <dd className="text-lg font-extrabold text-navy-900">{fallbackPrice}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-bold text-navy-900">Duration</dt>
            <dd className="text-navy-700">{SUBSCRIPTION_PLAN.durationLabel}</dd>
          </div>
        </dl>

        <GateNotice
          notice="Sign in to your SamTill account to proceed to secure Paystack payment and link your 6-Month Subscription."
          actionHref={loginHref('/checkout')}
          actionLabel="Sign in to pay"
        />
      </AccountShell>
    );
  }

  // ---- price list failures ----------------------------------------------

  if (plansState.status === 'failed') {
    const failure = plansState.failure;
    return (
      <AccountShell
        title={`${SUBSCRIPTION_PLAN.productName} — ${SUBSCRIPTION_PLAN.name}`}
        subtitle="Secure online payment"
        footer={backToPricingLink}
      >
        <StatusBanner tone="error">{failure.message}</StatusBanner>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          {failure.retryable && (
            <button
              type="button"
              onClick={() => {
                plansRequested.current = false;
                setPlansState({status: 'loading'});
                window.location.reload();
              }}
              className="text-navy-700 underline-offset-4 hover:underline"
            >
              Try again →
            </button>
          )}
        </div>
      </AccountShell>
    );
  }

  const plans = plansState.status === 'ready' ? plansState.plans : [];
  const plan =
    plans.find((candidate) => candidate.code === selected) ??
    plans.find((candidate) => candidate.code === SUBSCRIPTION_PLAN.id) ??
    plans[0] ??
    null;

  if (plansState.status === 'loading' && !plan) {
    return (
      <AccountShell title={`${SUBSCRIPTION_PLAN.productName} — ${SUBSCRIPTION_PLAN.name}`} subtitle="Secure online payment">
        <p className="text-sm text-navy-700" role="status">
          Loading subscription details…
        </p>
      </AccountShell>
    );
  }

  if (!plan) {
    return (
      <AccountShell
        title={`${SUBSCRIPTION_PLAN.productName} — ${SUBSCRIPTION_PLAN.name}`}
        subtitle="Secure online payment"
        footer={backToPricingLink}
      >
        <StatusBanner tone="error">
          The 6-Month Subscription plan is not active on the server yet. Please ensure the plan
          seed is applied and try again.
        </StatusBanner>
      </AccountShell>
    );
  }

  const formattedAmount = formatMinorAmount(plan.amountMinor, plan.currency);

  return (
    <AccountShell
      title={`Pay ${formattedAmount} — ${SUBSCRIPTION_PLAN.name}`}
      subtitle={`${SUBSCRIPTION_PLAN.productName} · ${SUBSCRIPTION_PLAN.paymentType} · ${plan.intervalMonths} Months`}
      footer={backToPricingLink}
    >
      {startFailure && (
        <div className="mb-5">
          <StatusBanner tone={bannerToneFor(startFailure.kind)}>
            {startFailure.message || checkoutFailureMessage(startFailure.kind)}
          </StatusBanner>
        </div>
      )}

      <dl className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Product</dt>
          <dd className="text-navy-700">{SUBSCRIPTION_PLAN.productName}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Subscription</dt>
          <dd className="text-navy-700">{plan.name}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Price</dt>
          <dd className="text-xl font-extrabold text-navy-900">{formattedAmount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Payment type</dt>
          <dd className="text-right text-navy-700">{SUBSCRIPTION_PLAN.paymentType}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Duration</dt>
          <dd className="text-right font-semibold text-navy-900">
            {plan.intervalMonths} Months from activation
          </dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-2">
        {SUBSCRIPTION_PLAN.features.map((feature) => (
          <li key={feature.label} className="flex items-start gap-2.5 text-sm text-slate-700">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              width="16"
              height="16"
              fill="currentColor"
              className="mt-0.5 shrink-0 text-amber-600"
            >
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
            <span>{feature.label}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => void handleBuy(plan.code)}
        disabled={starting}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber-700 px-6 py-4 text-sm font-extrabold uppercase tracking-wide text-white shadow-lg shadow-amber-700/20 transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
      >
        {starting && (
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        )}
        {starting ? 'Opening Paystack checkout…' : `PAY NOW — ${formattedAmount}`}
      </button>

      {starting && (
        <p className="mt-3 text-center text-sm text-navy-700" role="status">
          Connecting to Paystack hosted checkout…
        </p>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        {SUBSCRIPTION_TERMS.summary} Pay securely via Paystack with Mobile Money or Card.
      </p>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Signed in as {account.email ?? 'your account'}.{' '}
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          className="font-semibold text-navy-700 underline underline-offset-4 hover:text-amber-700"
        >
          Sign out
        </button>
      </p>
    </AccountShell>
  );
}
