import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {readCommerceEnv} from '../lib/commerceClient';
import {Reveal} from './Reveal';

/**
 * Additive preview of the customer area (accounts → payment).
 *
 * While every capability flag is off the section is purely informational —
 * status rows and a link to the existing contact section, no forms or
 * checkout. When the owner switches a flag on (after the flow is tested and
 * approved), the matching entry point to the real screen appears; the copy
 * below switches with it so the section never contradicts itself.
 */

const CAPABILITIES = [
  {
    label: 'Customer accounts',
    detail: 'Sign in with your email to manage your licence and account.',
    available: COMMERCE.accountEnabled,
  },
  {
    label: 'Online payment',
    detail: 'Card and mobile-money checkout — currently in test-mode preparation only.',
    available: COMMERCE.paymentsEnabled,
  },
] as const;

function statusChip(available: boolean): string {
  const base =
    'inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide';
  return available
    ? `${base} bg-emerald-100 text-emerald-800`
    : `${base} bg-navy-100 text-navy-700`;
}

export default function CommercePreview() {
  if (!COMMERCE.sectionEnabled) return null;

  const selfServiceOpen = COMMERCE.accountEnabled;
  const accountGate = accountAvailability(COMMERCE, readCommerceEnv());

  return (
    <section id="accounts" className="bg-slate-50 py-20 lg:py-28">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <p className="text-sm font-bold uppercase tracking-widest text-amber-600">
            {selfServiceOpen ? 'Customer area' : 'Customer area — in preparation'}
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-950 sm:text-4xl">
            {selfServiceOpen
              ? 'Your SamTill account'
              : 'Accounts and online payment — coming soon'}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-navy-800">
            {selfServiceOpen
              ? 'Create a SamTill account with your email, sign in, and manage your licence. SamTill itself runs in the browser and installs as an app — open the web app, then use your browser’s Install app / Add to Home Screen feature.'
              : 'SamTeck Digital is preparing a secure customer area for SamTill: sign in with your email and pay with card or mobile money for your licence.'}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-navy-600">
            {selfServiceOpen
              ? 'Online payment is still not available: packages, licences and payment are arranged directly with SamTeck Digital, and no price goes live before the owner has approved it.'
              : 'None of this is available yet. Until it launches, payment and installation are arranged directly with SamTeck Digital, and no price goes live before the owner has approved it.'}
          </p>
        </Reveal>

        <ul className="mt-8 space-y-3">
          {CAPABILITIES.map((item, index) => (
            <Reveal
              key={item.label}
              delayMs={index * 60}
              as="li"
              className="flex flex-col gap-3 rounded-xl border border-navy-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-navy-950">{item.label}</p>
                <p className="mt-0.5 text-sm text-navy-600">{item.detail}</p>
              </div>
              <span className={statusChip(item.available)}>
                {item.available ? 'Available' : 'Not yet available'}
              </span>
            </Reveal>
          ))}
        </ul>

        <Reveal delayMs={220}>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2">
            {accountGate.available && (
              <a
                href="/register"
                className="rounded-full bg-amber-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
              >
                Create an account →
              </a>
            )}
            <a
              href="#contact"
              className="font-semibold text-amber-600 underline-offset-4 hover:underline"
            >
              Enquire about access →
            </a>
            <p className="text-sm text-navy-600">
              Payment stays off until SamTeck Digital approves the pricing.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
