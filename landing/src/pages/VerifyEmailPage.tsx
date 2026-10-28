import {useEffect, useRef, useState, type ReactNode} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner from '../components/account/StatusBanner';
import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {verifyEmailAddress} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {verificationParams, type ParsedRoute} from '../lib/hashRoute';
import {navigateTo} from '../lib/navigation';
import {createAuthProvider} from '../lib/supabaseAdapter';

/**
 * Email verification landing screen.
 *
 * The confirmation email redirects here with `token_hash`/`type` (or a PKCE
 * `code`). A session is created ONLY if the provider accepts the link — the
 * screen says "verified" solely in that case, and shows the provider's real
 * error otherwise. A visit without parameters simply explains that the page
 * belongs to the emailed link.
 */

type State =
  | {status: 'idle'}
  | {status: 'verifying'}
  | {status: 'verified'; message: string; recovery: boolean}
  | {status: 'failed'; message: string};

export default function VerifyEmailPage({route}: {route: ParsedRoute}) {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const [state, setState] = useState<State>({status: 'idle'});
  const startedFor = useRef<string | null>(null);

  const paramsKey = route.params.toString();
  const pending = verificationParams(route.params);

  useEffect(() => {
    if (!availability.available || !pending) return;
    if (startedFor.current === paramsKey) return;
    startedFor.current = paramsKey;

    const client = getCommerceAuth();
    if (!client) {
      setState({status: 'failed', message: 'The account service is not configured on this site yet.'});
      return;
    }

    let active = true;
    setState({status: 'verifying'});
    verifyEmailAddress(createAuthProvider(client), pending)
      .then((result) => {
        if (!active) return;
        if (result.status === 'verified') {
          setState({
            status: 'verified',
            message: 'Your email address has been verified.',
            recovery: pending.mode === 'otp' && pending.type === 'recovery',
          });
          return;
        }
        setState({status: 'failed', message: result.message});
      })
      .catch(() => {
        if (!active) return;
        setState({status: 'failed', message: 'We could not verify this link right now. Please try again.'});
      });

    return () => {
      active = false;
    };
  }, [availability.available, pending, paramsKey]);

  if (!availability.available) {
    return (
      <AccountShell title="Verify your email" subtitle="Customer accounts">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  let body: ReactNode;

  if (state.status === 'idle' && !pending) {
    body = (
      <>
        <StatusBanner tone="info">
          This page completes the link from your verification email. Open the message we sent you
          and click the confirmation link inside it.
        </StatusBanner>
        <p className="mt-4 text-sm text-navy-700">
          If you have not registered yet, you can create an account first.
        </p>
      </>
    );
  } else if (state.status === 'verifying' || (state.status === 'idle' && pending)) {
    body = <p className="text-sm text-navy-700">Verifying your email address…</p>;
  } else if (state.status === 'verified') {
    body = (
      <>
        <StatusBanner tone="success">{state.message}</StatusBanner>
        {state.recovery ? (
          <button
            type="button"
            onClick={() => navigateTo('/reset-password')}
            className="mt-5 w-full rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Choose a new password →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigateTo('/account')}
            className="mt-5 w-full rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Continue to my account →
          </button>
        )}
      </>
    );
  } else if (state.status === 'failed') {
    body = (
      <>
        <StatusBanner tone="error">{state.message}</StatusBanner>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          <a href="#/login" className="text-amber-700 underline-offset-4 hover:underline">
            Go to sign in →
          </a>
          <a href="#/register" className="text-amber-700 underline-offset-4 hover:underline">
            Register again →
          </a>
        </div>
      </>
    );
  } else {
    // idle with parameters present: the verification effect is about to run.
    body = <p className="text-sm text-navy-700">Verifying your email address…</p>;
  }

  return (
    <AccountShell
      title="Verify your email"
      subtitle="Confirm that the address on your SamTill account is yours."
      footer={
        <p>
          <a href="#/" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
            Back to the SamTill website
          </a>
        </p>
      }
    >
      <div>{body}</div>
    </AccountShell>
  );
}
