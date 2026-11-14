import {useEffect, useRef, useState} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import {COMMERCE} from '../config/commerce';
import {LICENCE_TERMS, SAMTILL_PLAN, SAMTILL_PLAN_CODE} from '../config/pricing';
import {SITE} from '../config/site';
import {checkoutAvailability} from '../lib/availability';
import {readCommerceEnv} from '../lib/commerceClient';
import {
  checkoutFailureMessage,
  fetchMyAccess,
  fetchPublishedPlans,
  formatMinorAmount,
  startCheckout,
  verifyWithBackoff,
  type AccessEntitlement,
  type CheckoutFailure,
  type PlansFailure,
  type PublishedPlan,
  type VerifyResult,
} from '../lib/checkoutClient';
import {loginHref, registerHref} from '../lib/navigation';
import {useAccountSession} from '../lib/useAccountSession';
import {useHashRoute} from '../lib/useHashRoute';

/**
 * 6-Month Subscription checkout & verification screen.
 *
 * - Default plan: `samtill-6m` (GH₵500.00 single upfront payment for 6 months).
 * - Checks existing active entitlement via GET /api/subscription before charging
 *   so active subscribers clearly see their expiry date and "Open SamTill POS",
 *   with an optional "+6 Months Extension" action instead of accidental double pay.
 * - Handles Paystack return callback (`/?checkout=return&reference=...`).
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
  if (kind === 'needs_review' || kind === 'rate_limited') return 'info';
  return 'error';
}

function findActiveEntitlement(entitlements: AccessEntitlement[]): AccessEntitlement | null {
  const now = Date.now();
  const active = entitlements.filter(
    (item) => item.status === 'active' && Date.parse(item.validTo) > now,
  );
  if (active.length === 0) return null;
  active.sort((a, b) => Date.parse(b.validTo) - Date.parse(a.validTo));
  return active[0];
}

export default function CheckoutPage() {
  const apiBase = readCommerceEnv().apiBase;
  const availability = checkoutAvailability(COMMERCE, readCommerceEnv());
  const route = useHashRoute();
  const {loading, account, signOut} = useAccountSession();

  const reference = route.params.get('reference') ?? '';
  const planParam = route.params.get('plan') ?? '';

  const [plansState, setPlansState] = useState<PlansState>({status: 'loading'});
  const [selected, setSelected] = useState<string>(SAMTILL_PLAN_CODE);
  const [activeEntitlement, setActiveEntitlement] = useState<AccessEntitlement | null>(null);
  const [extendConfirmed, setExtendConfirmed] = useState(false);
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
    const chosen = planParam || window.sessionStorage.getItem(PLAN_KEY) || SAMTILL_PLAN_CODE;
    setSelected(chosen || SAMTILL_PLAN_CODE);
    try {
      window.sessionStorage.setItem(PLAN_KEY, chosen || SAMTILL_PLAN_CODE);
    } catch {
      // sessionStorage optional
    }
  }, [planParam]);

  useEffect(() => {
    if (plansRequested.current) return;
    plansRequested.current = true;
    void fetchPublishedPlans({apiBase}).then((result) => {
      if (!mounted.current) return;
      if (result.ok) setPlansState({status: 'ready', plans: result.plans});
      else setPlansState({status: 'failed', failure: result});
    });
  }, [apiBase]);

  // Check if signed-in customer already holds an active subscription
  useEffect(() => {
    if (!account || reference) {
      setActiveEntitlement(null);
      return;
    }
    let active = true;
    void fetchMyAccess({apiBase, accessToken: account.accessToken}).then((result) => {
      if (!active || !result.ok) return;
      setActiveEntitlement(findActiveEntitlement(result.entitlements));
    });
    return () => {
      active = false;
    };
  }, [account, apiBase, reference]);

  // Returning from Paystack: verify the reference with backoff
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

  async function handleBuy() {
    if (!account) return;
    const planCode = selected || SAMTILL_PLAN_CODE;
    setStartFailure(null);
    setStarting(true);
    const result = await startCheckout({
      apiBase,
      accessToken: account.accessToken,
      planCode,
    });
    if (result.ok) {
      try {
        window.sessionStorage.setItem(PLAN_KEY, result.plan.code);
      } catch {
        // optional
      }
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

  // ---- gates -------------------------------------------------------------

  if (!availability.available) {
    return (
      <AccountShell title="SamTill POS Subscription" subtitle="Secure online payment">
        <GateNotice notice={availability.notice} actionHref="/pricing" actionLabel="Back to Pricing" />
      </AccountShell>
    );
  }

  if (loading) {
    return (
      <AccountShell title="SamTill POS Subscription" subtitle="Secure online payment">
        <p className="text-sm text-navy-700">Checking your session…</p>
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
            <a
              href={registerHref('/checkout')}
              className="font-semibold text-amber-700 underline-offset-4 hover:underline"
            >
              Create an account →
            </a>
          }
        >
          <GateNotice
            notice="Sign in with the account you paid with so we can confirm your 6-Month Subscription."
            actionHref={loginHref('/checkout')}
            actionLabel="Sign in"
          />
        </AccountShell>
      );
    }

    if (verifyState.status === 'running' || verifyState.status === 'idle') {
      return (
        <AccountShell title="Confirm your payment" subtitle="Secure online payment">
          <div className="flex items-start gap-3 text-sm text-navy-700" role="status">
            <span className="mt-0.5 inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-navy-300 border-t-amber-600" />
            <p>
              Confirming your payment with Paystack… this usually takes a few seconds. Please keep
              this page open.
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
      return (
        <AccountShell
          title="Subscription activated"
          subtitle="Your SamTill POS 6-Month Subscription is now active."
          footer={
            <a href="#/account" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
              View billing &amp; account status →
            </a>
          }
        >
          <StatusBanner tone="success">
            Thank you — your payment of GH₵500.00 for the SamTill POS 6-Month Subscription is
            confirmed.
          </StatusBanner>

          {entitlement && (
            <dl className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
              <div>
                <dt className="font-bold text-navy-900">Plan</dt>
                <dd className="mt-0.5 text-navy-700">SamTill POS – 6-Month Subscription</dd>
              </div>
              <div>
                <dt className="font-bold text-navy-900">Status</dt>
                <dd className="mt-0.5 font-semibold text-emerald-700">Active (6 Months)</dd>
              </div>
              <div>
                <dt className="font-bold text-navy-900">Valid until</dt>
                <dd className="mt-0.5 text-navy-700">
                  {new Date(entitlement.validTo).toLocaleDateString('en-GH', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-navy-900">Payment reference</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-navy-700">
                  {result.reference}
                </dd>
              </div>
            </dl>
          )}

          <a
            href={SITE.webAppUrl}
            className="mt-5 block w-full rounded-full bg-amber-700 px-6 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Open SamTill POS →
          </a>

          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Single upfront payment completed — no automatic renewal charges. Sign in to SamTill POS
            with your account email and password.
          </p>
        </AccountShell>
      );
    }

    const failure = result;
    const actions: {label: string; onClick?: () => void; href?: string}[] = [];
    if (failure.kind === 'payment_pending' || failure.retryable || failure.kind === 'network') {
      actions.push({label: 'Check again', onClick: handleCheckAgain});
    }
    if (failure.kind === 'auth_required' || failure.kind === 'session_expired') {
      actions.push({label: 'Sign in again →', href: loginHref('/checkout')});
    }
    if (actions.length === 0) {
      actions.push({label: 'Back to Pricing', href: '/pricing'});
    }

    return (
      <AccountShell
        title="Confirm your payment"
        subtitle="Secure online payment"
        footer={
          <a href="#/" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
            ← Back to the SamTill website
          </a>
        }
      >
        <StatusBanner tone={bannerToneFor(failure.kind)}>{failure.message}</StatusBanner>

        {failure.kind === 'needs_review' && (
          <p className="mt-3 text-sm leading-relaxed text-navy-700">
            Your payment was received but needs a manual check. Send us this reference and we will
            activate your subscription: <strong className="font-mono">{reference}</strong>
          </p>
        )}

        {(failure.kind === 'amount_mismatch' ||
          failure.kind === 'currency_mismatch' ||
          failure.kind === 'metadata_mismatch') && (
          <p className="mt-3 text-sm leading-relaxed text-navy-700">
            This happens when a payment does not match the order on our side. Contact support with
            the reference <strong className="font-mono">{reference}</strong>.
          </p>
        )}

        {failure.kind === 'order_not_found' && (
          <p className="mt-3 text-sm leading-relaxed text-navy-700">
            If you were charged, contact SamTeck Digital with reference{' '}
            <strong className="font-mono">{reference}</strong>.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          {actions.map((action) =>
            action.href ? (
              <a
                key={action.label}
                href={action.href}
                className="text-amber-700 underline-offset-4 hover:underline"
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className="text-navy-700 underline-offset-4 hover:underline"
              >
                {action.label}
                {'retryAfterSeconds' in failure && failure.retryAfterSeconds
                  ? ` (~${failure.retryAfterSeconds}s)`
                  : ''}
              </button>
            ),
          )}
        </div>
      </AccountShell>
    );
  }

  // ---- not signed in -----------------------------------------------------

  if (!account) {
    return (
      <AccountShell
        title="SamTill POS – 6-Month Subscription"
        subtitle="GH₵500.00 · Single upfront payment · 6 Months access."
        footer={
          <a
            href={registerHref('/checkout')}
            className="font-semibold text-amber-700 underline-offset-4 hover:underline"
          >
            New customer? Create an account →
          </a>
        }
      >
        <GateNotice
          notice="Sign in or create an account so your 6-Month Subscription is linked to your shop owner login before paying."
          actionHref={loginHref('/checkout')}
          actionLabel="Sign in to Pay"
        />
      </AccountShell>
    );
  }

  // ---- existing active subscription guard --------------------------------

  if (activeEntitlement && !extendConfirmed) {
    return (
      <AccountShell
        title="Active SamTill Subscription"
        subtitle="You already have an active 6-Month Subscription on this account."
        footer={
          <a href="#/account" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
            View full account &amp; billing →
          </a>
        }
      >
        <StatusBanner tone="success">
          Your SamTill POS subscription is active until{' '}
          <strong>
            {new Date(activeEntitlement.validTo).toLocaleDateString('en-GH', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </strong>
          .
        </StatusBanner>

        <a
          href={SITE.webAppUrl}
          className="mt-5 block w-full rounded-full bg-amber-700 px-6 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-amber-800"
        >
          Open SamTill POS →
        </a>

        <button
          type="button"
          onClick={() => setExtendConfirmed(true)}
          className="mt-3 w-full rounded-full border border-slate-300 px-6 py-3 text-sm font-bold text-navy-800 transition-colors hover:border-navy-400 hover:bg-slate-50"
        >
          Extend early by another 6 Months (GH₵500.00)
        </button>
      </AccountShell>
    );
  }

  // ---- price resolution --------------------------------------------------

  if (plansState.status === 'failed') {
    const failure = plansState.failure;
    return (
      <AccountShell title="SamTill POS – 6-Month Subscription" subtitle="Secure online payment">
        <StatusBanner tone="error">{failure.message}</StatusBanner>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          {failure.retryable && (
            <button
              type="button"
              onClick={() => {
                plansRequested.current = false;
                setPlansState({status: 'loading'});
                void fetchPublishedPlans({apiBase}).then((res) => {
                  if (!mounted.current) return;
                  if (res.ok) setPlansState({status: 'ready', plans: res.plans});
                  else setPlansState({status: 'failed', failure: res});
                });
              }}
              className="text-navy-700 underline-offset-4 hover:underline"
            >
              Try again →
            </button>
          )}
          <a href="/pricing" className="text-amber-700 underline-offset-4 hover:underline">
            Back to Pricing →
          </a>
        </div>
      </AccountShell>
    );
  }

  const plans = plansState.status === 'ready' ? plansState.plans : [];
  const plan =
    plans.find((candidate) => candidate.code === selected) ??
    plans.find((candidate) => candidate.code === SAMTILL_PLAN_CODE) ??
    plans[0] ??
    null;

  if (plansState.status === 'loading' && !plan) {
    return (
      <AccountShell title="SamTill POS – 6-Month Subscription" subtitle="Secure online payment">
        <p className="text-sm text-navy-700" role="status">
          Loading subscription details…
        </p>
      </AccountShell>
    );
  }

  const effectiveAmount = plan
    ? `${formatMinorAmount(plan.amountMinor, plan.currency)}${plan.amountMinor % 100 === 0 ? '.00' : ''}`
    : `${SAMTILL_PLAN.currency}${SAMTILL_PLAN.price.toFixed(2)}`;
  const effectiveMonths = plan?.intervalMonths ?? SAMTILL_PLAN.intervalMonths;

  return (
    <AccountShell
      title={activeEntitlement ? 'Renew / Extend SamTill POS' : 'Buy SamTill POS'}
      subtitle="6-Month Subscription · Single upfront payment · Mobile Money or Card."
      footer={
        <a href="/pricing" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
          ← Back to Pricing
        </a>
      }
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
          <dd className="text-navy-700">SamTill POS</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Subscription</dt>
          <dd className="text-navy-700">{plan?.name ?? SAMTILL_PLAN.name}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Price</dt>
          <dd className="text-lg font-extrabold text-navy-900">{effectiveAmount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Payment Type</dt>
          <dd className="text-right text-navy-700">Single upfront payment</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Duration</dt>
          <dd className="text-right text-navy-700">{effectiveMonths} Months</dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-2">
        {SAMTILL_PLAN.features.slice(0, 4).map((feature) => (
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
        onClick={() => void handleBuy()}
        disabled={starting}
        className="mt-6 w-full rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
      >
        {starting ? 'Opening secure payment…' : `PAY NOW — ${effectiveAmount} via Paystack`}
      </button>

      {starting && (
        <div className="mt-3 flex items-center gap-2.5 text-sm text-navy-700" role="status">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-navy-300 border-t-amber-600" />
          Taking you to Paystack&apos;s secure page…
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        {LICENCE_TERMS.noAutoRenewal}{' '}
        <a href="/terms.html" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
          Terms
        </a>{' '}
        ·{' '}
        <a href="/privacy.html" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
          Privacy
        </a>
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
