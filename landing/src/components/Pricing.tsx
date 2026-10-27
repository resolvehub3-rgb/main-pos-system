import {LICENCE_TERMS, PACKAGES, PRICING_APPROVED} from '../config/pricing';
import {Reveal} from './Reveal';

function formatPrice(price: number): string {
  return price.toLocaleString('en-GH');
}

export default function Pricing() {
  return (
    <section id="pricing" className="bg-slate-50 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Pricing</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
            Choose the package that fits your shop
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            One-time licence per computer, including the first six months of maintenance and
            support.
          </p>
        </Reveal>

        {/* Owner-review notice — remove by setting PRICING_APPROVED = true in config/pricing.ts */}
        {!PRICING_APPROVED && (
          <Reveal delayMs={60}>
            <div
              role="note"
              className="mt-8 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-5"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="mt-0.5 shrink-0 text-amber-700"
              >
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
              <p className="text-sm font-medium leading-relaxed text-amber-900">
                <strong className="font-bold">Proposed pricing — awaiting owner approval.</strong>{' '}
                The prices and package contents below are a draft from SamTeck Digital and are
                shown for review. They are not final offers and must be confirmed by the owner
                before this website is published.
              </p>
            </div>
          </Reveal>
        )}

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {PACKAGES.map((pkg, index) => (
            <Reveal
              key={pkg.id}
              delayMs={index * 90}
              as="article"
              className="h-full"
            >
              <div
                className={`flex h-full flex-col rounded-2xl border p-7 transition-shadow duration-300 hover:shadow-xl ${
                  pkg.highlighted
                    ? 'border-amber-500 bg-white shadow-lg shadow-amber-500/10'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-extrabold text-navy-900">{pkg.name}</h3>
                  {pkg.highlighted && (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-700">
                      Recommended
                    </span>
                  )}
                </div>

                <p className="mt-4 flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-navy-900">
                    {pkg.currency}
                    {formatPrice(pkg.price)}
                  </span>
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {pkg.licenceType} · {pkg.licenceSeats}
                </p>

                <p className="mt-4 leading-relaxed text-slate-600">{pkg.description}</p>

                <ul className="mt-6 flex-1 space-y-3">
                  {pkg.features.map((feature) => (
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

                {pkg.draftTierFeatures && (
                  <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-800">
                    The feature split between packages is a proposal and is awaiting owner
                    confirmation — see the comparison table below.
                  </p>
                )}

                <a
                  href="#contact"
                  className={`mt-8 inline-flex items-center justify-center rounded-full px-6 py-3.5 text-sm font-bold transition-colors ${
                    pkg.highlighted
                      ? 'bg-amber-700 text-white hover:bg-amber-800'
                      : 'border-2 border-navy-900 text-navy-900 hover:border-amber-500 hover:text-amber-700'
                  }`}
                >
                  Enquire about {pkg.name}
                </a>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Licence terms footnote — always shown. */}
        <Reveal delayMs={120}>
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h3 className="text-base font-bold text-navy-900">Licence and support terms</h3>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
              <li className="flex gap-3">
                <span aria-hidden="true" className="text-amber-700">
                  •
                </span>
                {LICENCE_TERMS.summary}
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="text-amber-700">
                  •
                </span>
                {LICENCE_TERMS.permanentUse}
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="text-amber-700">
                  •
                </span>
                {LICENCE_TERMS.renewalNote}
              </li>
            </ul>
            {!PRICING_APPROVED && (
              <p className="mt-5 border-t border-slate-100 pt-4 text-xs font-medium text-amber-700">
                Draft pricing and terms, pending final approval by SamTeck Digital. Prices quoted
                are in Ghana cedis and are proposed as one-time licences for one computer.
              </p>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
