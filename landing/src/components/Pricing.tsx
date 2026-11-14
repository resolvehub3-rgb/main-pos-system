import {useEffect, useState} from 'react';
import {COMMERCE} from '../config/commerce';
import {LICENCE_TERMS, SAMTILL_PLAN, SAMTILL_PLAN_CODE} from '../config/pricing';
import {checkoutAvailability} from '../lib/availability';
import {fetchPublishedPlans, formatMinorAmount, type PublishedPlan} from '../lib/checkoutClient';
import {readCommerceEnv} from '../lib/commerceClient';
import {navigateTo} from '../lib/navigation';
import {useAccountSession} from '../lib/useAccountSession';
import {Reveal} from './Reveal';

const CHECKOUT_PLAN_KEY = 'samtill_checkout_plan';

function usePublishedSinglePlan(enabled: boolean): PublishedPlan | null {
  const [plan, setPlan] = useState<PublishedPlan | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const apiBase = readCommerceEnv().apiBase;
    let active = true;
    void fetchPublishedPlans({apiBase}).then((result) => {
      if (!active || !result.ok) return;
      const match =
        result.plans.find((item) => item.code === SAMTILL_PLAN_CODE) ?? result.plans[0] ?? null;
      setPlan(match);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return plan;
}

export default function Pricing() {
  const checkout = checkoutAvailability(COMMERCE, readCommerceEnv());
  const published = usePublishedSinglePlan(checkout.available);
  const {account} = useAccountSession();

  const priceDisplay = published
    ? `${formatMinorAmount(published.amountMinor, published.currency)}${published.amountMinor % 100 === 0 ? '.00' : ''}`
    : `${SAMTILL_PLAN.currency}${SAMTILL_PLAN.price.toFixed(2)}`;

  const durationMonths = published?.intervalMonths ?? SAMTILL_PLAN.intervalMonths;

  function handlePayNow() {
    try {
      window.sessionStorage.setItem(CHECKOUT_PLAN_KEY, SAMTILL_PLAN.id);
    } catch {
      // sessionStorage optional
    }
    if (account) {
      navigateTo(`/checkout?plan=${SAMTILL_PLAN.id}`);
    } else {
      navigateTo(`/login?next=checkout`);
    }
  }

  return (
    <section id="pricing" className="bg-slate-50 py-20 lg:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Pricing</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
            Simple, straightforward 6-month access
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            One plan with everything included — no tiers, no hidden charges, and no surprise monthly
            auto-debits.
          </p>
        </Reveal>

        <Reveal delayMs={80} className="mx-auto mt-12 max-w-xl">
          <article className="rounded-3xl border-2 border-amber-500 bg-white p-8 shadow-xl shadow-amber-500/10 sm:p-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-amber-700">
                  {SAMTILL_PLAN.productName}
                </p>
                <h3 className="mt-1 text-2xl font-extrabold text-navy-900">
                  {SAMTILL_PLAN.name}
                </h3>
              </div>
              <span className="rounded-full bg-amber-100 px-3.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                {durationMonths} Months Access
              </span>
            </div>

            <div className="mt-6 border-y border-slate-100 py-6">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-5xl font-extrabold tracking-tight text-navy-950">
                  {priceDisplay}
                </span>
                <span className="text-sm font-semibold text-slate-500">
                  / {SAMTILL_PLAN.durationLabel}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-navy-700">
                {SAMTILL_PLAN.paymentType} · Valid for {durationMonths} full calendar months
              </p>
            </div>

            <p className="mt-6 text-base leading-relaxed text-slate-600">
              {SAMTILL_PLAN.description}
            </p>

            <ul className="mt-6 space-y-3">
              {SAMTILL_PLAN.features.map((feature) => (
                <li key={feature.label} className="flex items-start gap-3 text-sm text-slate-700">
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

            <button
              type="button"
              onClick={handlePayNow}
              className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-amber-700 px-8 py-4 text-base font-extrabold tracking-wide text-white shadow-lg shadow-amber-700/25 transition-colors hover:bg-amber-800"
            >
              PAY NOW — {priceDisplay}
            </button>

            <p className="mt-3 text-center text-xs text-slate-500">
              Pay securely via Paystack (Mobile Money, Visa, Mastercard) · Instant verification
            </p>
          </article>
        </Reveal>

        <Reveal delayMs={140} className="mx-auto mt-10 max-w-xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h3 className="text-sm font-bold text-navy-900">Subscription terms</h3>
            <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-slate-600">
              <li className="flex gap-2.5">
                <span aria-hidden="true" className="text-amber-700">
                  •
                </span>
                <span>{LICENCE_TERMS.summary}</span>
              </li>
              <li className="flex gap-2.5">
                <span aria-hidden="true" className="text-amber-700">
                  •
                </span>
                <span>{LICENCE_TERMS.noAutoRenewal}</span>
              </li>
              <li className="flex gap-2.5">
                <span aria-hidden="true" className="text-amber-700">
                  •
                </span>
                <span>{LICENCE_TERMS.renewalNote}</span>
              </li>
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
