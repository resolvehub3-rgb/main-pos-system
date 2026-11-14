import {useState, type ChangeEvent, type FormEvent} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import TextField from '../components/account/TextField';
import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {registerAccount, type RegisterOutcome} from '../lib/authFlow';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {nextRouteAfterSignIn} from '../lib/hashRoute';
import {navigateTo} from '../lib/navigation';
import {ensureProvisionedShop} from '../lib/shopProvisioning';
import {createAuthProvider} from '../lib/supabaseAdapter';
import {useHashRoute} from '../lib/useHashRoute';
import {
  hasErrors,
  validateShopRegistration,
  type FieldErrors,
  type RegistrationInput,
} from '../lib/validation';

/**
 * Customer & business owner registration.
 *
 * Uses existing Supabase Authentication + `create_tenant_with_owner` RPC so each
 * registered owner gets a single real POS shop/tenant without duplicates.
 */

type ShopRegistrationValues = RegistrationInput & {
  shopName: string;
  shopAddress: string;
};

const EMPTY: ShopRegistrationValues = {
  shopName: '',
  shopAddress: '',
  fullName: '',
  phone: '',
  email: '',
  password: '',
};

export default function RegisterPage() {
  const route = useHashRoute();
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const [values, setValues] = useState<ShopRegistrationValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);

  const nextParam = route.params.get('next');
  const signInHref = nextParam ? `#/login?next=${encodeURIComponent(nextParam)}` : '#/login';

  if (!availability.available) {
    return (
      <AccountShell title="Create your SamTill account" subtitle="Business registration">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  const set =
    (field: keyof ShopRegistrationValues) => (event: ChangeEvent<HTMLInputElement>) => {
      const next = {...values, [field]: event.target.value};
      setValues(next);
      if (errors[field]) {
        const revalidated = validateShopRegistration(next);
        setErrors((current) => ({...current, [field]: revalidated[field]}));
      }
    };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBanner(null);

    const client = getCommerceAuth();
    if (!client) {
      setBanner({
        tone: 'error',
        message: 'The customer account service is not configured for this deployment yet.',
      });
      return;
    }

    const clientErrors = validateShopRegistration(values);
    if (hasErrors(clientErrors)) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    const verifyRedirect = nextParam
      ? `${window.location.origin}/#/verify?next=${encodeURIComponent(nextParam)}`
      : `${window.location.origin}/#/verify`;

    const result: RegisterOutcome = await registerAccount(createAuthProvider(client), values, {
      emailRedirectTo: verifyRedirect,
      requireShopName: true,
    });

    if (result.status === 'signed_in') {
      const shopResult = await ensureProvisionedShop(client, {
        shopName: values.shopName,
        shopAddress: values.shopAddress,
        fullName: values.fullName,
        phone: values.phone,
      });
      setSubmitting(false);

      if (!shopResult.ok) {
        setBanner({
          tone: 'error',
          message:
            shopResult.error ||
            'Account created, but shop setup could not be finalized yet. Sign in to retry.',
        });
        return;
      }

      setBanner({
        tone: 'success',
        message:
          nextParam === 'checkout'
            ? 'Your SamTill account and shop are ready. Taking you to the 6-Month Subscription checkout…'
            : result.message,
      });
      window.setTimeout(() => navigateTo(nextRouteAfterSignIn(route.params)), 500);
      return;
    }

    setSubmitting(false);

    switch (result.status) {
      case 'invalid_input':
        setErrors(result.errors);
        return;
      case 'pending_verification':
        setValues(EMPTY);
        setBanner({
          tone: 'info',
          message:
            nextParam === 'checkout'
              ? `${result.message} Once verified, sign in to complete your 6-Month Subscription checkout (GH₵500.00).`
              : result.message,
        });
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
      subtitle={
        nextParam === 'checkout'
          ? 'Step 1 of 2: Register your shop account to proceed to the GH₵500.00 6-Month Subscription checkout.'
          : 'Register your business to get started with SamTill POS.'
      }
      footer={
        <p>
          Already registered?{' '}
          <a href={signInHref} className="font-bold text-amber-700 underline-offset-4 hover:underline">
            Sign in →
          </a>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {banner && <StatusBanner tone={banner.tone}>{banner.message}</StatusBanner>}

        <TextField
          id="register-shop-name"
          label="Shop / Business name"
          type="text"
          autoComplete="organization"
          placeholder="e.g. Kwesi Mart Supermarket"
          required
          value={values.shopName}
          onChange={set('shopName')}
          error={errors.shopName}
        />
        <TextField
          id="register-shop-address"
          label="Shop location / city (optional)"
          type="text"
          placeholder="e.g. Madina, Accra"
          value={values.shopAddress}
          onChange={set('shopAddress')}
          error={errors.shopAddress}
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

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {submitting
            ? 'Creating your account…'
            : nextParam === 'checkout'
              ? 'Create account & continue to checkout'
              : 'Create account'}
        </button>

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Creating your account sets up your SamTill shop workspace using Supabase Authentication.
          POS subscription access activates for 6 months after verifying your GH₵500.00 Paystack
          payment.
        </p>
      </form>
    </AccountShell>
  );
}
