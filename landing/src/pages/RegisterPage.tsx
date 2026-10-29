import {useState, type ChangeEvent, type FormEvent} from 'react';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import TextField from '../components/account/TextField';
import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {
  registerAccount,
  type RegisterOutcome,
} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {navigateTo} from '../lib/navigation';
import {createAuthProvider} from '../lib/supabaseAdapter';
import {
  hasErrors,
  validateRegistration,
  type FieldErrors,
  type RegistrationInput,
} from '../lib/validation';

/**
 * Customer registration.
 *
 * Only the fields the commerce account model stores are collected: email,
 * password, full name, optional phone. A website account is NOT a POS shop,
 * tenant or licence — the page says so plainly.
 *
 * Outcomes (src/lib/authFlow.ts):
 * - `pending_verification` → "check your email" (the address is NOT yet
 *   claimed to be verified),
 * - `signed_in`            → provider did not require confirmation,
 * - `duplicate_email`      → clear guidance to sign in / reset instead.
 */

const EMPTY: RegistrationInput = {email: '', password: '', fullName: '', phone: ''};

export default function RegisterPage() {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const [values, setValues] = useState<RegistrationInput>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);

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

    const result: RegisterOutcome = await registerAccount(
      createAuthProvider(client),
      values,
      {emailRedirectTo: `${window.location.origin}/#/verify`},
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
          message: `${result.message} After you verify your email and sign in, your account will be reviewed and you will be emailed as soon as it is approved.`,
        });
        return;
      case 'signed_in':
        setBanner({tone: 'success', message: result.message});
        window.setTimeout(() => navigateTo('/account'), 600);
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
      subtitle="Register to manage your SamTill account and licence. We only ask for what the account needs."
      footer={
        <p>
          Already registered?{' '}
          <a href="#/login" className="font-bold text-amber-700 underline-offset-4 hover:underline">
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
          Creating an account does not activate a SamTill POS licence and does not start any
          payment. New accounts are reviewed and approved by SamTeck Digital before they can be
          used. Passwords are sent securely to the SamTill account service and are never shown on
          this website.
        </p>
      </form>
    </AccountShell>
  );
}
