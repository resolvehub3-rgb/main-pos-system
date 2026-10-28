import {useState, type ChangeEvent, type FormEvent} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import TextField from '../components/account/TextField';
import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {requestPasswordReset} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {createAuthProvider} from '../lib/supabaseAdapter';

/**
 * Password reset — step 1: request a reset link by email.
 * The response wording never confirms whether an account exists.
 */

export default function ForgotPasswordPage() {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);

  if (!availability.available) {
    return (
      <AccountShell title="Reset your password" subtitle="Customer accounts">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  function setEmailField(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);
    if (error) setError(undefined);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBanner(null);

    const client = getCommerceAuth();
    if (!client) {
      setBanner({tone: 'error', message: 'The account service is not configured on this site yet.'});
      return;
    }

    setSubmitting(true);
    const result = await requestPasswordReset(createAuthProvider(client), email, {
      redirectTo: `${window.location.origin}/#/reset-password`,
    });
    setSubmitting(false);

    if (result.status === 'invalid_input') {
      setError(result.message);
      return;
    }
    if (result.status === 'error') {
      setBanner({tone: 'error', message: result.message});
      return;
    }
    setBanner({tone: 'success', message: result.message});
    setEmail('');
  }

  return (
    <AccountShell
      title="Reset your password"
      subtitle="Enter the email address of your SamTill account and we will send you a link to choose a new password."
      footer={
        <p className="space-x-4">
          <a href="#/login" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
            Back to sign in →
          </a>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {banner && <StatusBanner tone={banner.tone}>{banner.message}</StatusBanner>}

        <TextField
          id="reset-email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={setEmailField}
          error={error}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-full bg-navy-900 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-navy-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {submitting ? 'Sending the reset link…' : 'Send reset link'}
        </button>
      </form>
    </AccountShell>
  );
}
