import {useEffect, useState, type ChangeEvent, type FormEvent} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import TextField from '../components/account/TextField';
import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {registerAccount, type RegisterOutcome} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {nextRouteAfterSignIn} from '../lib/hashRoute';
import {loginHref, navigateTo} from '../lib/navigation';
import {createAuthProvider} from '../lib/supabaseAdapter';
import {useAccountSession} from '../lib/useAccountSession';
import {useHashRoute} from '../lib/useHashRoute';
import {
  hasErrors,
  validateRegistration,
  type FieldErrors,
  type RegistrationInput,
} from '../lib/validation';

const EMPTY: RegistrationInput = {email: '', password: '', fullName: '', phone: ''};

export default function RegisterPage() {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const route = useHashRoute();
  const {loading, account} = useAccountSession();
  const [values, setValues] = useState<RegistrationInput>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);

  const nextParam = route.params.get('next');
  const nextRoute = nextRouteAfterSignIn(route.params);

  useEffect(() => {
    if (!loading && account) {
      navigateTo(nextRoute);
    }
  }, [loading, account, nextRoute]);

  if (!availability.available) {
    return (
      <AccountShell title="Create your SamTill account" subtitle="Customer registration">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  const set = (field: keyof RegistrationInput) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = {...values, [field]: event.target.value};
      setValues(next);
      if (errors[field]) {
        const revalidated = validateRegistration(next);
        setErrors((current) => ({...current, [field]: revalidated[field]}));
      }
    };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBanner(null);

    const client = getCommerceAuth();
    if (!client) {
      setBanner({tone: 'error', message: 'The account service is not configured on this site yet.'});
      return;
    }

    const clientErrors = validateRegistration(values);
    if (hasErrors(clientErrors)) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    const verifyUrl = nextParam
      ? `${window.location.origin}/#/verify?next=${encodeURIComponent(nextParam)}`
      : `${window.location.origin}/#/verify`;

    const result: RegisterOutcome = await registerAccount(
      createAuthProvider(client),
      values,
      {emailRedirectTo: verifyUrl},
    );
    setSubmitting(false);

    switch (result.status) {
      case 'invalid_input':
        setErrors(result.errors);
        return;
      case 'pending_verification':
        setValues(EMPTY);
        setBanner({
          tone: 'info',
          message: `${result.message} After confirming your email, you can continue straight to checkout.`,
        });
        return;
      case 'signed_in':
        setBanner({tone: 'success', message: result.message});
        window.setTimeout(() => navigateTo(nextRoute), 500);
        return;
      case 'duplicate_email':
        setBanner({tone: 'info', message: result.message});
        return;
      case 'error':
        setBanner({tone: 'error', message: result.message});
        return;
    }
  }

  return (
    <AccountShell
      title="Create your SamTill account"
      subtitle="Register to manage your SamTill POS 6-Month Subscription and billing."
      footer={
        <p>
          Already registered?{' '}
          <a
            href={nextParam === 'checkout' ? loginHref('/checkout') : '#/login'}
            className="font-bold text-amber-700 underline-offset-4 hover:underline"
          >
            Sign in →
          </a>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {banner && <StatusBanner tone={banner.tone}>{banner.message}</StatusBanner>}

        <TextField
          id="register-email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={values.email}
          onChange={set('email')}
          error={errors.email}
        />
        <TextField
          id="register-password"
          label="Password (at least 8 characters)"
          type="password"
          autoComplete="new-password"
          required
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <TextField
          id="register-name"
          label="Full name"
          type="text"
          autoComplete="name"
          required
          value={values.fullName}
          onChange={set('fullName')}
          error={errors.fullName}
        />
        <TextField
          id="register-phone"
          label="Phone number (optional)"
          type="tel"
          autoComplete="tel"
          placeholder="024 123 4567"
          value={values.phone}
          onChange={set('phone')}
          error={errors.phone}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {submitting ? 'Creating your account…' : 'Create account'}
        </button>

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Creating an account does not charge your card or mobile money wallet. Once signed in,
          you can activate your 6-Month Subscription (GH₵500.00) or access your existing billing
          status.
        </p>
      </form>
    </AccountShell>
  );
}
