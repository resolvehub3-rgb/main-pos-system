import {useEffect, useRef, useState} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import {COMMERCE} from '../config/commerce';
import {LICENCE_TERMS, PACKAGES} from '../config/pricing';
import {SITE} from '../config/site';
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
import {loginHref} from '../lib/navigation';
import {useAccountSession} from '../lib/useAccountSession';
import {useHashRoute} from '../lib/useHashRoute';

/**
 * Buy a licence, come back from Paystack, and confirm the payment.
 *
 * Journey:
 *   1. `#/checkout?plan=starter`   → review the server-published price,
 *                                    "Pay with Paystack" → hosted checkout;
 *   2. Paystack redirects back to `/?checkout=return&reference=…`
 *      (App.tsx forwards that to this screen),
 *   3. the screen calls POST /api/verify with backoff until the webhook or
 *      the verification call settles it, then shows the entitlement.
 *
 * The browser never sends a price and never declares a payment successful:
 * the price comes from GET /api/plans and success only ever comes from the
 * server's own verify answer (which itself checks the provider).
 *
 * The chosen plan code is kept in sessionStorage so signing in first
 * (`#/login?next=checkout`) does not lose the customer's choice.
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

export default function CheckoutPage() {
  const apiBase = readCommerceEnv().apiBase;
  const availability = checkoutAvailability(COMMERCE, readCommerceEnv());
  const route = useHashRoute();
  const {loading, account, signOut} = useAccountSession();

  const reference = route.params.get('reference') ?? '';
  const planParam = route.params.get('plan') ?? '';

  const [plansState, setPlansState] = useState<PlansState>({status: 'loading'});
  const [selected, setSelected] = useState<string | null>(null);
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

  // Remember the package the customer came from (also survives signing in).
  useEffect(() => {
    const chosen = planParam || window.sessionStorage.getItem(PLAN_KEY) || '';
    if (chosen) {
      setSelected(chosen);
      if (planParam) window.sessionStorage.setItem(PLAN_KEY, planParam);
    }
  }, [planParam]);

  // Price list: public endpoint, fetched once.
  useEffect(() => {
    if (plansRequested.current) return;
    plansRequested.current = true;
    void fetchPublishedPlans({apiBase}).then((result) => {
      if (!mounted.current) return;
      if (result.ok) setPlansState({status: 'ready', plans: result.plans});
      else setPlansState({status: 'failed', failure: result});
    });
  }, [apiBase]);

  // Returning from Paystack: verify the reference, with backoff for a webhook
  // that has not landed yet. Runs only once per reference and only when the
  // customer has a session (the endpoint requires one).
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
    if (!account || !selected) return;
    setStartFailure(null);
    setStarting(true);
    const result = await startCheckout({
      apiBase,
      accessToken: account.accessToken,
      planCode: selected,
    });
    if (result.ok) {
      window.sessionStorage.setItem(PLAN_KEY, result.plan.code);
      // Leaving this origin for Paystack's hosted page.
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
      <AccountShell title="Buy SamTill" subtitle="Secure online payment">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  if (loading) {
    return (
      <AccountShell title="Buy SamTill" subtitle="Secure online payment">
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
            <a href="#/register" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
              Create an account →
            </a>
          }
        >
          <GateNotice
            notice="Sign in with the account you paid with so we can confirm your payment and show your licence."
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
      const planPackage = PACKAGES.find((pkg) => pkg.id === selected);
      return (
        <AccountShell
          title="Payment confirmed"
          subtitle="Your SamTill licence is active on this account."
          footer={
            <a href="#/account" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
              ← Back to my account
            </a>
          }
        >
          <StatusBanner tone="success">
            Thank you — we received your payment of{' '}
            {planPackage ? `${planPackage.currency}${planPackage.price.toLocaleString('en-GH')}` : 'your package'}{' '}
            for the {planPackage ? planPackage.name : 'SamTill'} licence.
          </StatusBanner>

          {entitlement && (
            <dl className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
              <div>
                <dt className="font-bold text-navy-900">Access includes</dt>
                <dd className="mt-0.5 text-navy-700">
                  App updates and software access for{' '}
                  {LICENCE_TERMS.includedSupportMonths} months from purchase, plus{' '}
                  {LICENCE_TERMS.includedSupportMonths} months of maintenance and support.
                </dd>
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

          {SITE.webAppUrl ? (
            <a
              href={SITE.webAppUrl}
              className="mt-5 block w-full rounded-full bg-amber-700 px-6 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-amber-800"
            >
              Open the SamTill app →
            </a>
          ) : (
            <p className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-navy-700">
              SamTill runs in the browser and installs as an app: open the SamTill web app, then
              use your browser’s Install app / Add to Home Screen feature.
            </p>
          )}

          <p className="mt-5 text-xs leading-relaxed text-slate-500">
            Your licence is permanent for the version you bought; access and support run for the
            included six months. Sign in to the web app with the same email address and
            password you used here. Keep the reference above for your records.
          </p>
        </AccountShell>
      );
    }

    // ---- verify failed ---------------------------------------------------
    const failure = result;
    const actions: {label: string; onClick?: () => void; href?: string}[] = [];
    if (failure.kind === 'payment_pending' || failure.retryable || failure.kind === 'network') {
      actions.push({label: 'Check again', onClick: handleCheckAgain});
    }
    if (failure.kind === 'auth_required' || failure.kind === 'session_expired') {
      actions.push({label: 'Sign in again →', href: loginHref('/checkout')});
    }
    if (failure.kind === 'not_configured') {
      actions.push({label: 'Back to the website', href: '#/'});
    }
    if (actions.length === 0) {
      actions.push({label: 'Back to packages', href: '#/'});
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
            activate your licence or refund you: <strong className="font-mono">{reference}</strong>
          </p>
        )}

        {(failure.kind === 'amount_mismatch' ||
          failure.kind === 'currency_mismatch' ||
          failure.kind === 'metadata_mismatch') && (
          <p className="mt-3 text-sm leading-relaxed text-navy-700">
            This happens when a payment does not match the order on our side. Contact support with
            the reference <strong className="font-mono">{reference}</strong> — you will not be
            charged twice.
          </p>
        )}

        {failure.kind === 'order_not_found' && (
          <p className="mt-3 text-sm leading-relaxed text-navy-700">
            If you were charged, contact SamTeck Digital with the reference{' '}
            <strong className="font-mono">{reference}</strong>.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          {actions.map((action) =>
            action.href ? (
              <a key={action.label} href={action.href} className="text-amber-700 underline-offset-4 hover:underline">
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
          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            className="text-navy-700 underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        </div>
      </AccountShell>
    );
  }

  // ---- not signed in -----------------------------------------------------

  if (!account) {
    return (
      <AccountShell
        title="Buy SamTill"
        subtitle="Pay once — one-time licence, one computer, six months of support."
        footer={
          <a href="#/register" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
            Create an account →
          </a>
        }
      >
        <GateNotice
          notice="A SamTill account holds your licence, so payment needs a sign-in first. Your chosen package is kept — you will come straight back here."
          actionHref={loginHref('/checkout')}
          actionLabel="Sign in"
        />
      </AccountShell>
    );
  }

  // ---- price list problems ----------------------------------------------

  if (plansState.status === 'failed') {
    const failure = plansState.failure;
    return (
      <AccountShell title="Buy SamTill" subtitle="Secure online payment">
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
          <a href="#/" className="text-amber-700 underline-offset-4 hover:underline">
            Back to the website →
          </a>
        </div>
      </AccountShell>
    );
  }

  const plans = plansState.status === 'ready' ? plansState.plans : [];

  // ---- choosing a package (no package preselected) ----------------------

  if (!selected && plansState.status === 'ready') {
    return (
      <AccountShell
        title="Buy SamTill"
        subtitle="One-time licence per computer, including six months of maintenance and support."
        footer={
          <a href="#/#pricing" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
            ← Compare the packages
          </a>
        }
      >
        <ul className="space-y-3">
          {plans.map((plan) => {
            const copy = PACKAGES.find((pkg) => pkg.id === plan.code);
            return (
              <li key={plan.code}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(plan.code);
                    window.sessionStorage.setItem(PLAN_KEY, plan.code);
                  }}
                  className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 text-left transition-colors hover:border-amber-500 hover:bg-amber-50"
                >
                  <span>
                    <span className="block text-sm font-extrabold text-navy-900">{plan.name}</span>
                    {copy && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                        {copy.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-lg font-extrabold text-navy-900">
                    {formatMinorAmount(plan.amountMinor, plan.currency)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-5 text-xs leading-relaxed text-slate-500">
          Prices are set by the server and charged in Ghana cedis through Paystack (mobile money or
          card).
        </p>
      </AccountShell>
    );
  }

  // ---- reviewing / paying ------------------------------------------------

  const plan = plans.find((candidate) => candidate.code === selected) ?? null;
  const packageCopy = PACKAGES.find((pkg) => pkg.id === selected) ?? null;

  if (plansState.status === 'loading' && !plan) {
    return (
      <AccountShell title="Buy SamTill" subtitle="Secure online payment">
        <p className="text-sm text-navy-700" role="status">
          Loading the current price…
        </p>
      </AccountShell>
    );
  }

  if (!plan) {
    return (
      <AccountShell title="Buy SamTill" subtitle="Secure online payment">
        <StatusBanner tone="error">
          That package is not available for purchase right now. Please choose another package or
          contact SamTeck Digital.
        </StatusBanner>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              window.sessionStorage.removeItem(PLAN_KEY);
            }}
            className="text-navy-700 underline-offset-4 hover:underline"
          >
            Choose another package →
          </button>
          <a href="#/" className="text-amber-700 underline-offset-4 hover:underline">
            Back to the website →
          </a>
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title={`Buy ${plan.name}`}
      subtitle="One-time licence · one computer · six months of maintenance and support."
      footer={
        <a href="#/#pricing" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
          ← Compare packages
        </a>
      }
    >
      {startFailure && (
        <div className="mb-5">
          <StatusBanner tone={bannerToneFor(startFailure.kind)}>
            {startFailure.message || checkoutFailureMessage(startFailure.kind)}
          </StatusBanner>
          {startFailure.kind === 'checkout_disabled' && (
            <p className="mt-3 text-sm leading-relaxed text-navy-700">
              Online checkout is not open yet. Use the enquiry form on the website and SamTeck
              Digital will arrange the purchase with you.
            </p>
          )}
        </div>
      )}

      <dl className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Package</dt>
          <dd className="text-navy-700">{plan.name}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Price</dt>
          <dd className="text-lg font-extrabold text-navy-900">
            {formatMinorAmount(plan.amountMinor, plan.currency)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Licence</dt>
          <dd className="text-right text-navy-700">One-time · 1 computer</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Support included</dt>
          <dd className="text-right text-navy-700">{LICENCE_TERMS.includedSupportMonths} months</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-bold text-navy-900">Updates &amp; support</dt>
          <dd className="text-right text-navy-700">
            {plan.intervalMonths} months from purchase
          </dd>
        </div>
      </dl>

      {packageCopy && (
        <ul className="mt-4 space-y-2">
          {packageCopy.features.map((feature) => (
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
              <span>
                {feature.label}
                {feature.detail ? ` — ${feature.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={handleBuy}
        disabled={starting}
        className="mt-6 w-full rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
      >
        {starting ? 'Opening secure payment…' : `Pay ${formatMinorAmount(plan.amountMinor, plan.currency)} with Paystack`}
      </button>

      {starting && (
        <div className="mt-3 flex items-center gap-2.5 text-sm text-navy-700" role="status">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-navy-300 border-t-amber-600" />
          Taking you to Paystack's secure page…
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        You will be redirected to Paystack to pay by mobile money or card. We never see or store
        your card details or PIN. Paying confirms the{' '}
        <a href="/terms.html" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
          terms of service
        </a>{' '}
        and the{' '}
        <a href="/privacy.html" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
          privacy policy
        </a>
        . Nothing is charged until you confirm on their page.
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
