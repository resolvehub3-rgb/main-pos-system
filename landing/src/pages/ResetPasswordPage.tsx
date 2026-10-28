import {useEffect, useRef, useState, type ChangeEvent, type FormEvent} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import TextField from '../components/account/TextField';
import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {setNewPassword, verifyEmailAddress} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {verificationParams, type ParsedRoute} from '../lib/hashRoute';
import {navigateTo} from '../lib/navigation';
import {createAuthProvider} from '../lib/supabaseAdapter';
import {useAccountSession} from '../lib/useAccountSession';
import {validateNewPassword} from '../lib/validation';

/**
 * Password reset — step 2: choose a new password.
 *
 * Reached from the emailed recovery link (`#/reset-password?token_hash=…`
 * or `…?code=…`). The recovery session is created by the provider first; only
 * then can `updateUser` set the new password. Without a link (or an expired
 * one) the screen says so and points back to step 1 — it never pretends a
 * password was changed.
 */

type Phase =
  | {status: 'preparing'}
  | {status: 'needs_link'; message: string}
  | {status: 'ready'}
  | {status: 'failed'; message: string};

export default function ResetPasswordPage({route}: {route: ParsedRoute}) {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const {loading, account} = useAccountSession();
  const [phase, setPhase] = useState<Phase>({status: 'preparing'});
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);
  const startedFor = useRef<string | null>(null);

  const paramsKey = route.params.toString();
  const pending = verificationParams(route.params);

  useEffect(() => {
    if (!availability.available) return;

    // Already holding a session (recovery completed earlier in this tab).
    if (account) {
      setPhase({status: 'ready'});
      return;
    }
    if (loading) return;

    // No link in the URL and no session → step 1 required.
    if (!pending) {
      setPhase({
        status: 'needs_link',
        message: 'Open the password reset link from your email to choose a new password.',
      });
      return;
    }

    if (startedFor.current === paramsKey) return;
    startedFor.current = paramsKey;

    const client = getCommerceAuth();
    if (!client) {
      setPhase({status: 'failed', message: 'The account service is not configured on this site yet.'});
      return;
    }

    let active = true;
    setPhase({status: 'preparing'});
    verifyEmailAddress(createAuthProvider(client), pending)
      .then((result) => {
        if (!active) return;
        if (result.status === 'verified') {
          setPhase({status: 'ready'});
          return;
        }
        setPhase({status: 'failed', message: result.message});
      })
      .catch(() => {
        if (!active) return;
        setPhase({status: 'failed', message: 'We could not open this reset link right now. Please request a new one.'});
      });

    return () => {
      active = false;
    };
  }, [availability.available, account, loading, pending, paramsKey]);

  if (!availability.available) {
    return (
      <AccountShell title="Choose a new password" subtitle="Customer accounts">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  function setPasswordField(event: ChangeEvent<HTMLInputElement>) {
    setPassword(event.target.value);
    if (fieldError) setFieldError(undefined);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBanner(null);

    const client = getCommerceAuth();
    if (!client) {
      setBanner({tone: 'error', message: 'The account service is not configured on this site yet.'});
      return;
    }

    const invalid = validateNewPassword(password);
    if (invalid) {
      setFieldError(invalid);
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);

    const result = await setNewPassword(createAuthProvider(client), password);
    setSubmitting(false);

    if (result.status === 'invalid_input') {
      setFieldError(result.message);
      return;
    }
    if (result.status === 'error') {
      setBanner({tone: 'error', message: result.message});
      return;
    }
    setPassword('');
    setBanner({tone: 'success', message: result.message});
    setPhase({status: 'ready'});
  }

  if (phase.status === 'preparing') {
    return (
      <AccountShell title="Choose a new password" subtitle="Customer accounts">
        <p className="text-sm text-navy-700">Opening your reset link…</p>
      </AccountShell>
    );
  }

  if (phase.status === 'needs_link' || phase.status === 'failed') {
    const failed = phase.status === 'failed';
    return (
      <AccountShell
        title="Choose a new password"
        subtitle="Customer accounts"
        footer={
          <a href="#/login" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
            Back to sign in →
          </a>
        }
      >
        <StatusBanner tone={failed ? 'error' : 'info'}>{phase.message}</StatusBanner>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          <a href="#/forgot-password" className="text-amber-700 underline-offset-4 hover:underline">
            Request a new reset link →
          </a>
          <a href="#/login" className="text-navy-700 underline-offset-4 hover:underline">
            Sign in →
          </a>
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Choose a new password"
      subtitle="Pick a password of at least 8 characters. You will use it the next time you sign in."
      footer={
        <a href="#/login" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
          Back to sign in →
        </a>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {banner && <StatusBanner tone={banner.tone}>{banner.message}</StatusBanner>}

        <TextField
          id="new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={setPasswordField}
          error={fieldError}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {submitting ? 'Updating your password…' : 'Update password'}
        </button>

        <p className="mt-4 text-center text-sm">
          <button
            type="button"
            onClick={() => navigateTo('/account')}
            className="font-semibold text-navy-700 underline-offset-4 hover:underline"
          >
            Back to my account
          </button>
        </p>
      </form>
    </AccountShell>
  );
}
