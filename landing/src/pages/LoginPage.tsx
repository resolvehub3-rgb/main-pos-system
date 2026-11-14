import {useEffect, useRef, useState, type ChangeEvent, type FormEvent} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import TextField from '../components/account/TextField';
import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {resendConfirmation, signInToAccount} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {nextRouteAfterSignIn, type ParsedRoute} from '../lib/hashRoute';
import {navigateTo} from '../lib/navigation';
import {ensureProvisionedShop} from '../lib/shopProvisioning';
import {createAuthProvider} from '../lib/supabaseAdapter';
import {useAccountSession} from '../lib/useAccountSession';
import {hasErrors, validateSignIn, type FieldErrors} from '../lib/validation';

/**
 * Sign-in for customer and business owner accounts.
 */

export default function LoginPage({route}: {route: ParsedRoute}) {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const {loading, account} = useAccountSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const routingRef = useRef(false);

  const next = route.params.get('next');

  // Already signed in (or just signed in) -> ensure owner shop provisioned, then go to next route.
  useEffect(() => {
    if (loading || !account || routingRef.current) return;
    routingRef.current = true;
    const client = getCommerceAuth();
    const destination = nextRouteAfterSignIn(route.params);
    if (!client) {
      navigateTo(destination);
      return;
    }
    void ensureProvisionedShop(client, {}, {createFallbackIfMissing: next === 'checkout'})
      .catch(() => ({ok: true}))
      .finally(() => {
        navigateTo(destination);
      });
  }, [loading, account, route.params, next]);

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
    setUnverifiedEmail(null);
    setResendState('idle');

    const client = getCommerceAuth();
    if (!client) {
      setBanner({
        tone: 'error',
        message: 'The customer account service is not configured for this deployment yet.',
      });
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
      if (result.kind === 'email_not_confirmed') setUnverifiedEmail(email.trim());
      return;
    }
    setBanner({
      tone: 'success',
      message:
        next === 'checkout'
          ? 'Signed in. Opening your 6-Month Subscription checkout…'
          : 'Signed in. Taking you to your account…',
    });
  }

  async function handleResend() {
    if (!unverifiedEmail || resendState !== 'idle') return;
    const client = getCommerceAuth();
    if (!client) return;

    setResendState('sending');
    const redirectTo = next
      ? `${window.location.origin}/#/verify?next=${encodeURIComponent(next)}`
      : `${window.location.origin}/#/verify`;
    const result = await resendConfirmation(createAuthProvider(client), unverifiedEmail, {
      redirectTo,
    });

    if (result.status === 'sent') {
      setResendState('sent');
      setBanner({tone: 'info', message: result.message});
      return;
    }
    setResendState('idle');
    setBanner({tone: 'error', message: result.message});
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
      subtitle="Access your SamTill account and licence information."
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

        {unverifiedEmail && (
          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-center text-sm">
            <p className="text-navy-700">
              Your email address has not been confirmed yet, so you cannot sign in until it is.
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState !== 'idle'}
              className="mt-2 font-bold text-amber-700 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {resendState === 'sending'
                ? 'Sending…'
                : resendState === 'sent'
                  ? 'Confirmation email sent ✓'
                  : 'Resend the confirmation email →'}
            </button>
          </div>
        )}
      </form>
    </AccountShell>
  );
}
