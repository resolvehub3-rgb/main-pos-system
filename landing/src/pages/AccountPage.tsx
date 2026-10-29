import {useEffect, useState} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import {COMMERCE} from '../config/commerce';
import {PACKAGES} from '../config/pricing';
import {SITE} from '../config/site';
import {accountAvailability, checkoutAvailability} from '../lib/availability';
import {resendConfirmation} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {fetchMyAccess, type AccessResult} from '../lib/checkoutClient';
import {navigateTo} from '../lib/navigation';
import {createAuthProvider} from '../lib/supabaseAdapter';
import {useAccountSession} from '../lib/useAccountSession';

/**
 * Signed-in customer account screen: identity, email-verification status,
 * the licence this account holds, how to get the app, and sign-out.
 *
 * Verification status is read from the session the provider returned — the
 * screen never states that an address is verified unless the provider says
 * so (`email_confirmed_at` present). Licence state comes from the server's
 * own GET /api/subscription answer, never from anything the browser computed.
 */

function planLabel(planCode: string | null): string {
  const match = planCode ? PACKAGES.find((pkg) => pkg.id === planCode) : undefined;
  return match ? match.name : planCode ?? 'SamTill licence';
}

export default function AccountPage() {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const checkout = checkoutAvailability(COMMERCE, readCommerceEnv());
  const {loading, account, session, signOut} = useAccountSession();
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);
  const [resending, setResending] = useState(false);
  const [access, setAccess] = useState<AccessResult | null>(null);

  const accessToken = account?.accessToken ?? '';
  const apiBase = readCommerceEnv().apiBase;

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

  const client = getCommerceAuth();
  const sessionUserEmail = account.email ?? '';
  // The provider only sets email_confirmed_at once verification succeeded.
  const emailConfirmed = Boolean(session?.user?.email_confirmed_at);

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
      subtitle="Your SamTill customer account details."
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
          Your email address has not been verified yet. Check your inbox for the confirmation
          link, or send it again.
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

      {access?.ok && (access.entitlements.length > 0 || checkout.available) && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-sm font-bold text-navy-900">Your SamTill licence</h2>
          {access.entitlements.length === 0 ? (
            <>
              <p className="mt-1 text-sm text-navy-700">
                This account does not have a licence yet. Choose a package to buy one — your
                licence appears here as soon as payment is confirmed.
              </p>
              {checkout.available ? (
                <button
                  type="button"
                  onClick={() => navigateTo('/checkout')}
                  className="mt-3 rounded-full bg-amber-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
                >
                  Choose a package →
                </button>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Packages are listed on the website; contact SamTeck Digital to purchase.
                </p>
              )}
            </>
          ) : (
            <ul className="mt-3 space-y-4">
              {access.entitlements.map((entitlement) => {
                const now = Date.now();
                const withinWindow =
                  entitlement.status === 'active' && Date.parse(entitlement.validTo) > now;
                const badge = withinWindow
                  ? {label: 'Active', classes: 'bg-emerald-100 text-emerald-800'}
                  : entitlement.status === 'revoked'
                    ? {label: 'Revoked', classes: 'bg-red-100 text-red-800'}
                    : {label: 'Expired', classes: 'bg-slate-200 text-slate-700'};
                return (
                  <li key={`${entitlement.planCode ?? entitlement.productCode}-${entitlement.validTo}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold text-navy-900">
                        {planLabel(entitlement.planCode)}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {withinWindow
                        ? 'Access and included support run until '
                        : entitlement.status === 'revoked'
                          ? 'Access was revoked on '
                          : 'Included access ended on '}
                      {new Date(entitlement.validTo).toLocaleDateString('en-GH', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      .
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          {access.ok &&
            access.entitlements.length > 0 &&
            access.entitlements.every(
              (entitlement) =>
                entitlement.status !== 'active' ||
                Date.parse(entitlement.validTo) <= Date.now(),
            ) &&
            checkout.available && (
              <button
                type="button"
                onClick={() => navigateTo('/checkout')}
                className="mt-4 rounded-full bg-amber-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
              >
                Renew or buy again →
              </button>
            )}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-sm font-bold text-navy-900">Get the app</h2>
        <p className="mt-1 text-sm text-navy-700">
          SamTill runs in the browser and installs as an app. Open the SamTill web app, then use
          your browser’s Install app / Add to Home Screen feature to keep it on your device.
        </p>
        {SITE.webAppUrl && (
          <a
            href={SITE.webAppUrl}
            className="mt-3 inline-flex rounded-full bg-amber-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Open the SamTill app →
          </a>
        )}
      </div>

      <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
        Your account holds your licence and account information. Creating an
        account does not activate a SamTill POS licence and does not commit you to any payment.
      </p>

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
