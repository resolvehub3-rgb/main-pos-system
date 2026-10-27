import type {ReactNode} from 'react';
import {Reveal} from './Reveal';

interface Feature {
  title: string;
  body: string;
  icon: ReactNode;
}

/** Icons drawn inline so the site ships with no icon-font dependency. */
const icon = (path: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);

const FEATURES: Feature[] = [
  {
    title: 'Barcode checkout',
    body: 'Scan a barcode or search by name to ring up a sale, take cash, MoMo or card, and close the sale in seconds.',
    icon: icon(
      <>
        <path d="M3 5v14M7 5v14M11 5v10M15 5v14M19 5v14" />
      </>,
    ),
  },
  {
    title: 'Product management',
    body: 'Keep a clean catalogue of products with prices, categories, units and cost — updated once and used at every till.',
    icon: icon(
      <>
        <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
        <path d="m3 8 9 5 9-5M12 13v8" />
      </>,
    ),
  },
  {
    title: 'Stock movement records',
    body: 'A stock book that records opening stock, received, sales, returns and adjustments per product per day.',
    icon: icon(
      <>
        <path d="M4 19V5M4 19h16" />
        <path d="M8 15v-4M12 15V8M16 15v-6" />
      </>,
    ),
  },
  {
    title: 'Receipt printing',
    body: 'Print a customer receipt the moment a sale is completed, with reprints available from sales history.',
    icon: icon(
      <>
        <path d="M6 9V3h12v6" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
        <path d="M6 14h12v7H6z" />
      </>,
    ),
  },
  {
    title: 'Sales reports',
    body: 'See total sales, orders, profit and top-selling products for the day, week or month — and export for your records.',
    icon: icon(
      <>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
        <path d="M14 3v6h6M8 17v-3M12 17v-6M16 17v-2" />
      </>,
    ),
  },
  {
    title: 'Customer-facing display',
    body: 'Show the customer what is being scanned and what they owe on a second screen while the cashier keeps working.',
    icon: icon(
      <>
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>,
    ),
  },
];

export default function Features() {
  return (
    <section id="features" className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Features</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
            Everything a shop needs at the counter and behind it
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Each capability below is taken from the SamTill application itself — nothing on this
            page is a concept or a promise.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delayMs={index * 70} as="article" className="h-full">
              <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-7 transition-shadow duration-300 hover:shadow-xl hover:shadow-navy-900/5">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  {feature.icon}
                </span>
                <h3 className="mt-5 text-lg font-bold text-navy-900">{feature.title}</h3>
                <p className="mt-3 leading-relaxed text-slate-600">{feature.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
