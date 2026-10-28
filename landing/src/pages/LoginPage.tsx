import {useEffect, useState, type ChangeEvent, type FormEvent} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import TextField from '../components/account/TextField';
import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {signInToAccount} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {nextRouteAfterSignIn, type ParsedRoute} from '../lib/hashRoute';
import {navigateTo} from '../lib/navigation';
import {createAuthProvider} from '../lib/supabaseAdapter';
import {useAccountSession} from '../lib/useAccountSession';
import {hasErrors, validateSignIn, type FieldErrors} from '../lib/validation';

/**
 * Sign-in for customer accounts.
 *
 * Loading, error and success states are explicit; an unverified customer is
 * told plainly that verification is still required (in the recommended
 * configuration the provider refuses the session until the address is
 * confirmed, and we never claim otherwise).
 */

export default function LoginPage({route}: {route: ParsedRoute}) {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const {loading, account} = useAccountSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);

  // Already signed in (or just signed in) → go to the requested screen.
  useEffect(() => {
    if (!loading && account) {
      navigateTo(nextRouteAfterSignIn(route.params));
    }
  }, [loading, account, route.params]);

  if (!availability.available) {
    return (
      <AccountShell title="Sign in" subtitle="Customer accounts">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  function setEmailField(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);
    if (errors.email) setErrors((current) => ({...current, email: undefined}));
  }

  function setPasswordField(event: ChangeEvent<HTMLInputElement>) {
    setPassword(event.target.value);
    if (errors.password) setErrors((current) => ({...current, password: undefined}));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBanner(null);

    const client = getCommerceAuth();
    if (!client) {
      setBanner({tone: 'error', message: 'The account service is not configured on this site yet.'});
      return;
    }

    const clientErrors = validateSignIn({email, password});
    if (hasErrors(clientErrors)) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    const result = await signInToAccount(createAuthProvider(client), {email, password});
    setSubmitting(false);

    if (result.status === 'invalid_input') {
      setErrors(result.errors);
      return;
    }
    if (result.status === 'error') {
      setBanner({tone: 'error', message: result.message});
      return;
    }
    // Signed in — useAccountSession picks the session up and the effect above
    // navigates to the requested screen.
    setBanner({tone: 'success', message: 'Signed in. Taking you to your account…'});
  }

  if (loading && !account) {
    return (
      <AccountShell title="Sign in" subtitle="Customer accounts">
        <p className="text-sm text-navy-700">Checking your session…</p>
      </AccountShell>
    );
  }

  const next = route.params.get('next');

  return (
    <AccountShell
      title="Sign in"
      subtitle="Access your SamTill account and Windows installer downloads."
      footer={
        <p>
          New here?{' '}
          <a
            href={next ? `#/register?next=${encodeURIComponent(next)}` : '#/register'}
            className="font-bold text-amber-700 underline-offset-4 hover:underline"
          >
            Create an account →
          </a>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {banner && <StatusBanner tone={banner.tone}>{banner.message}</StatusBanner>}

        <TextField
          id="login-email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={setEmailField}
          error={errors.email}
        />
        <TextField
          id="login-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={setPasswordField}
          error={errors.password}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-full bg-navy-900 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-navy-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-4 text-center text-sm">
          <a
            href="#/forgot-password"
            className="font-semibold text-amber-700 underline-offset-4 hover:underline"
          >
            Forgot your password?
          </a>
        </p>
      </form>
    </AccountShell>
  );
}
