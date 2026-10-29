import {Reveal} from './Reveal';

function buildFaqs(): Array<{q: string; a: string}> {
  return [
  {
    q: 'What is SamTill?',
    a: 'SamTill is a point-of-sale and retail management application by SamTeck Digital for supermarkets and shops in Ghana. It covers barcode checkout, product and category management, stock movement records, receipt printing, sales reporting and a customer-facing display.',
  },
  {
    q: 'How much does SamTill cost?',
    a: 'There are three proposed packages — Starter, Business and Professional — shown in the pricing section above. These prices are still a draft awaiting final approval by SamTeck Digital, so please enquire to confirm the current price before making any decision.',
  },
  {
    q: 'Is the licence a subscription?',
    a: 'Each package is proposed as a one-time licence for one computer, including the first six months of maintenance and support. Permanent use applies to the licensed version. Maintenance, support and updates after that initial period may require renewal under the final terms approved by SamTeck Digital.',
  },
  {
    q: 'Do I pay online?',
    a: 'No. Online payment is not available yet. You enquire first, agree the package and terms with SamTeck Digital directly, and payment is arranged between you and the business.',
  },
  {
    q: 'Can I install it myself?',
    a: 'Yes — SamTill runs in the browser and installs as an app: open the SamTill web app, then use your browser’s Install app (or Add to Home Screen) feature to keep it on your device. SamTeck Digital can still help with setup in your shop.',
  },
  {
    q: 'What hardware do I need?',
    a: 'SamTill runs on one computer per licence. Receipt printing uses a standard thermal receipt printer, and barcode scanning uses a standard USB barcode scanner. SamTeck Digital will confirm the exact setup for your shop during enrolment.',
  },
  {
    q: 'Does it work for multiple staff?',
    a: 'Yes. SamTill has staff accounts with different roles — for example a shop-owner view and a cashier till — so the owner sees reports and settings while cashiers work at the point of sale.',
  },
  {
    q: 'What happens to my business data?',
    a: 'Your shop data belongs to you. Details of how data is stored and backed up for your installation are confirmed in writing during setup, before you activate a licence.',
  },
  ];
}

export default function Faq() {
  const faqs = buildFaqs();

  return (
    <section id="faq" className="bg-navy-950 py-20 lg:py-28">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <p className="text-sm font-bold uppercase tracking-widest text-amber-400">
            Frequently asked questions
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Answers before you enquire
          </h2>
        </Reveal>

        <div className="mt-10 space-y-3">
          {faqs.map((item, index) => (
            <Reveal key={item.q} delayMs={index * 50}>
              <details className="group rounded-xl border border-navy-700 bg-navy-900/60 transition-colors open:border-amber-500/50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-base font-semibold text-white [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="shrink-0 text-amber-400 transition-transform duration-300 group-open:rotate-45"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-navy-200">{item.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
