import {useEffect, useState} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import {COMMERCE} from '../config/commerce';
import {SUBSCRIPTION_PLAN} from '../config/pricing';
import {accountAvailability, checkoutAvailability} from '../lib/availability';
import {resendConfirmation} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {
  fetchMyAccess,
  hasActiveSubscriptionAccess,
  type AccessResult,
} from '../lib/checkoutClient';
import {navigateTo} from '../lib/navigation';
import {createAuthProvider} from '../lib/supabaseAdapter';
import {useAccountSession} from '../lib/useAccountSession';

/**
 * Signed-in customer & business owner account screen.
 * Reads real subscription and business details via /api/subscription.
 */

function planLabel(planCode: string | null): string {
  if (!planCode || planCode === SUBSCRIPTION_PLAN.id) {
    return `${SUBSCRIPTION_PLAN.productName} — ${SUBSCRIPTION_PLAN.name}`;
  }
  return planCode;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function AccountPage() {
  const env = readCommerceEnv();
  const availability = accountAvailability(COMMERCE, env);
  const checkout = checkoutAvailability(COMMERCE, env);
  const {loading, account, session, signOut} = useAccountSession();
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);
  const [resending, setResending] = useState(false);
  const [access, setAccess] = useState<AccessResult | null>(null);

  const client = getCommerceAuth();
  const accessToken = account?.accessToken ?? '';
  const apiBase = env.apiBase;

  useEffect(() => {
    if (!accessToken) {
      setAccess(null);
      return;
    }
    let active = true;
    void fetchMyAccess({apiBase, accessToken}).then((result) => {
      if (active) setAccess(result);
    });
    return () => {
      active = false;
    };
  }, [accessToken, apiBase]);

  if (!availability.available) {
    return (
      <AccountShell title="My account" subtitle="Customer accounts">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  if (loading) {
    return (
      <AccountShell title="My account" subtitle="Customer accounts">
        <p className="text-sm text-navy-700">Checking your session…</p>
      </AccountShell>
    );
  }

  if (!account) {
    return (
      <AccountShell
        title="My account"
        subtitle="Sign in to see your SamTill account."
        footer={
          <a href="#/register" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
            Create an account →
          </a>
        }
      >
        <GateNotice
          notice="Sign in with your SamTill account to open this page."
          actionHref="#/login"
          actionLabel="Sign in"
        />
      </AccountShell>
    );
  }

  const sessionUserEmail = account.email ?? '';
  const emailConfirmed = Boolean(session?.user?.email_confirmed_at);
  const tenant = access?.ok ? access.tenant ?? null : null;
  const activeWindow = access?.ok ? hasActiveSubscriptionAccess(access) : {active: false, validFrom: null, validTo: null};

  async function handleResend() {
    if (!client || !sessionUserEmail) return;
    setResending(true);
    const result = await resendConfirmation(createAuthProvider(client), sessionUserEmail, {
      redirectTo: `${window.location.origin}/#/verify`,
    });
    setResending(false);
    setBanner({
      tone: result.status === 'sent' ? 'success' : 'error',
      message: result.message,
    });
  }

  async function handleSignOut() {
    await signOut();
    setBanner({tone: 'info', message: 'You have been signed out.'});
  }

  return (
    <AccountShell
      title="My account"
      subtitle="Your SamTill POS business account and subscription details."
      footer={
        <a href="#/" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
          Back to the SamTill website
        </a>
      }
    >
      {banner && <StatusBanner tone={banner.tone}>{banner.message}</StatusBanner>}

      <dl className="mt-2 space-y-4 text-sm">
        <div>
          <dt className="font-bold text-navy-900">Email address</dt>
          <dd className="mt-0.5 text-navy-700">{sessionUserEmail || 'Not available'}</dd>
        </div>
        {tenant && (
          <div>
            <dt className="font-bold text-navy-900">Business / Shop</dt>
            <dd className="mt-0.5 text-navy-700">{tenant.name}</dd>
          </div>
        )}
        <div>
          <dt className="font-bold text-navy-900">Email verification</dt>
          <dd className="mt-0.5">
            {emailConfirmed ? (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
                Verified
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                Not verified yet
              </span>
            )}
          </dd>
        </div>
      </dl>

      {!emailConfirmed && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
          Your email address has not been verified yet. Check your inbox for the confirmation link,
          or send it again.
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="mt-3 block rounded-full bg-amber-700 px-5 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
          >
            {resending ? 'Sending…' : 'Resend confirmation email'}
          </button>
        </div>
      )}

      {access === null && (
        <p className="mt-6 text-sm text-slate-600">Loading your SamTill POS subscription status…</p>
      )}

      {access && !access.ok && (
        <div className="mt-6">
          <StatusBanner tone="info">{access.message}</StatusBanner>
        </div>
      )}

      {access?.ok && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-sm font-bold text-navy-900">SamTill POS 6-Month Subscription</h2>

          {activeWindow.active ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-navy-900">
                  {planLabel(tenant?.subscriptionPlanCode ?? SUBSCRIPTION_PLAN.id)}
                </span>
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
                  Active
                </span>
              </div>
              {activeWindow.validFrom && (
                <p className="text-xs text-slate-600">
                  Started: <strong className="text-navy-900">{formatDate(activeWindow.validFrom)}</strong>
                </p>
              )}
              {activeWindow.validTo && (
                <p className="text-xs text-slate-600">
                  Valid until: <strong className="text-emerald-800">{formatDate(activeWindow.validTo)}</strong>
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-navy-700">
                No active 6-Month Subscription is linked to this account yet. Complete a single upfront
                payment of GH₵{SUBSCRIPTION_PLAN.price.toFixed(2)} to activate your POS workspace for 6
                months.
              </p>
              {checkout.available && (
                <button
                  type="button"
                  onClick={() => navigateTo(`/checkout?plan=${SUBSCRIPTION_PLAN.id}`)}
                  className="mt-4 rounded-full bg-amber-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
                >
                  PAY NOW (GH₵500.00 / 6 Months) →
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-sm font-bold text-navy-900">Open SamTill POS</h2>
        <p className="mt-1 text-sm text-navy-700">
          Open the POS terminal and management workspace in your browser, or install it on this
          device as a PWA.
        </p>
        <a
          href="/app/dashboard"
          className="mt-3 inline-flex rounded-full bg-navy-900 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-navy-800"
        >
          Open SamTill POS →
        </a>
      </div>

      <button
        type="button"
        onClick={handleSignOut}
        className="mt-6 w-full rounded-full border border-slate-300 px-6 py-3 text-sm font-bold text-navy-800 transition-colors hover:border-navy-400 hover:bg-slate-50"
      >
        Sign out
      </button>
    </AccountShell>
  );
}
