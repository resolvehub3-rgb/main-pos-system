import {useEffect, useState} from 'react';
import {COMMERCE} from '../config/commerce';
import {SUBSCRIPTION_PLAN, SUBSCRIPTION_TERMS} from '../config/pricing';
import {checkoutAvailability} from '../lib/availability';
import {
  checkoutFailureMessage,
  fetchPublishedPlans,
  formatMinorAmount,
  startCheckout,
  type PublishedPlan,
} from '../lib/checkoutClient';
import {readCommerceEnv} from '../lib/commerceClient';
import {navigateTo} from '../lib/navigation';
import {useAccountSession} from '../lib/useAccountSession';
import {Reveal} from './Reveal';

const PLAN_KEY = 'samtill_checkout_plan';

/**
 * Price source: the server-published plan list wins whenever it loads, so the
 * displayed amount stays synchronized with /api/plans and Paystack checkout.
 */
function usePublishedPlan(enabled: boolean): PublishedPlan | null {
  const [plan, setPlan] = useState<PublishedPlan | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const apiBase = readCommerceEnv().apiBase;
    let active = true;
    void fetchPublishedPlans({apiBase}).then((result) => {
      if (!active || !result.ok) return;
      const match =
        result.plans.find((entry) => entry.code === SUBSCRIPTION_PLAN.id) ??
        result.plans[0] ??
        null;
      setPlan(match);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return plan;
}

interface PricingProps {
  isStandalonePage?: boolean;
}

export default function Pricing({isStandalonePage = false}: PricingProps) {
  const env = readCommerceEnv();
  const checkout = checkoutAvailability(COMMERCE, env);
  const publishedPlan = usePublishedPlan(checkout.available);
  const {account} = useAccountSession();

  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const formattedPrice = publishedPlan
    ? formatMinorAmount(publishedPlan.amountMinor, publishedPlan.currency)
    : formatMinorAmount(SUBSCRIPTION_PLAN.amountMinor, SUBSCRIPTION_PLAN.currencyCode);

  const durationText = publishedPlan
    ? `${publishedPlan.intervalMonths} Months`
    : SUBSCRIPTION_PLAN.durationLabel;

  async function handlePayNow() {
    setPayError(null);
    try {
      window.sessionStorage.setItem(PLAN_KEY, SUBSCRIPTION_PLAN.id);
    } catch {
      // Ignore storage access errors in locked-down browsers.
    }

    if (checkout.available && account) {
      setPaying(true);
      const result = await startCheckout({
        apiBase: env.apiBase,
        accessToken: account.accessToken,
        planCode: publishedPlan?.code ?? SUBSCRIPTION_PLAN.id,
      });
      if (result.ok) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      setPaying(false);
      setPayError(result.message || checkoutFailureMessage(result.kind));
      return;
    }

    navigateTo(`/checkout?plan=${SUBSCRIPTION_PLAN.id}`);
  }

  const SectionHeading = isStandalonePage ? 'h1' : 'h2';
  const CardHeading = isStandalonePage ? 'h2' : 'h3';

  return (
    <section id="pricing" className="bg-slate-50 py-12 lg:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Pricing</p>
          <SectionHeading className="mt-2 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
            Simple, straightforward pricing
          </SectionHeading>
          <p className="mt-3 text-base leading-relaxed text-slate-600 sm:text-lg">
            One complete {SUBSCRIPTION_PLAN.productName} plan with every feature included — no
            complex tiers and no recurring monthly charges.
          </p>
        </Reveal>

        <Reveal delayMs={80} as="article" className="mx-auto mt-8 max-w-xl">
          <div className="overflow-hidden rounded-3xl border-2 border-amber-500 bg-white shadow-xl shadow-navy-900/10">
            <div className="bg-navy-950 px-6 py-5 text-white sm:px-8 sm:py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-amber-400">
                    {SUBSCRIPTION_PLAN.productName}
                  </p>
                  <CardHeading className="mt-0.5 text-2xl font-extrabold tracking-tight text-white">
                    {SUBSCRIPTION_PLAN.name}
                  </CardHeading>
                </div>
                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-3.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-300 ring-1 ring-amber-400/40">
                  {durationText}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
                  {formattedPrice}
                </span>
                <span className="text-base font-semibold text-navy-200">/ {durationText}</span>
              </div>
              <p className="mt-1.5 text-sm font-medium text-amber-300">
                {SUBSCRIPTION_PLAN.paymentType} · {durationText} from activation
              </p>
            </div>

            <div className="p-6 sm:p-8">
              <p className="text-sm leading-relaxed text-slate-700 sm:text-base">
                {SUBSCRIPTION_PLAN.description}
              </p>

              <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
                {SUBSCRIPTION_PLAN.features.map((feature) => (
                  <li key={feature.label} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      width="18"
                      height="18"
                      fill="currentColor"
                      className="mt-0.5 shrink-0 text-amber-600"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>
                      {feature.label}
                      {feature.detail ? ` — ${feature.detail}` : ''}
                    </span>
                  </li>
                ))}
              </ul>

              {payError && (
                <div
                  role="alert"
                  className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900"
                >
                  <p>{payError}</p>
                  <button
                    type="button"
                    onClick={() => navigateTo(`/checkout?plan=${SUBSCRIPTION_PLAN.id}`)}
                    className="mt-2 font-bold text-red-800 underline underline-offset-4 hover:text-red-950"
                  >
                    Open checkout status →
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handlePayNow()}
                disabled={paying}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber-700 px-8 py-4 text-base font-extrabold uppercase tracking-wide text-white shadow-lg shadow-amber-700/25 transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {paying && (
                  <span
                    aria-hidden="true"
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                )}
                {paying ? 'Starting secure checkout…' : 'PAY NOW'}
              </button>

              <p className="mt-3 text-center text-xs text-slate-500">
                Secure payment via Paystack (Mobile Money or Card) · Instant 6-month activation
                upon verification
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delayMs={140} className="mx-auto mt-10 max-w-2xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h3 className="text-base font-bold text-navy-900">Subscription terms</h3>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
              <li className="flex gap-3">
                <span aria-hidden="true" className="text-amber-700">
                  •
                </span>
                {SUBSCRIPTION_TERMS.summary}
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="text-amber-700">
                  •
                </span>
                {SUBSCRIPTION_TERMS.activation}
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="text-amber-700">
                  •
                </span>
                {SUBSCRIPTION_TERMS.renewalNote}
              </li>
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
