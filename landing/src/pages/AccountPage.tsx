import {useState} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import {COMMERCE} from '../config/commerce';
import {accountAvailability, downloadAvailability} from '../lib/availability';
import {resendConfirmation} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {navigateTo} from '../lib/navigation';
import {createAuthProvider} from '../lib/supabaseAdapter';
import {useAccountSession} from '../lib/useAccountSession';

/**
 * Signed-in customer account screen: identity, email-verification status,
 * entry point to the installer download and sign-out.
 *
 * Verification status is read from the session the provider returned — the
 * screen never states that an address is verified unless the provider says
 * so (`email_confirmed_at` present). Creating an account is explicitly not a
 * POS licence activation.
 */

export default function AccountPage() {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const download = downloadAvailability(COMMERCE, readCommerceEnv());
  const {loading, account, session, signOut} = useAccountSession();
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);
  const [resending, setResending] = useState(false);

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
      subtitle="Your SamTill customer account details and downloads."
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

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-sm font-bold text-navy-900">Windows installer</h2>
        {download.available ? (
          <>
            <p className="mt-1 text-sm text-navy-700">
              Download the genuine SamTill Windows installer for your account.
            </p>
            <button
              type="button"
              onClick={() => navigateTo('/download')}
              className="mt-3 rounded-full bg-amber-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
            >
              Go to downloads →
            </button>
          </>
        ) : (
          <p className="mt-1 text-sm text-navy-700">{download.notice}</p>
        )}
      </div>

      <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
        Your account gives you access to your downloads and account information. Creating an
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
