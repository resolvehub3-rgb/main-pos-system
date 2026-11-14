import {Reveal} from './Reveal';

const FAQS: Array<{q: string; a: string}> = [
  {
    q: 'What is SamTill?',
    a: 'SamTill is a point-of-sale and retail management application by SamTeck Digital for supermarkets and shops in Ghana. It covers barcode checkout, product and category management, stock movement records, receipt printing, sales reporting and a customer-facing display.',
  },
  {
    q: 'How much does SamTill POS cost?',
    a: 'SamTill POS is offered under one clear 6-Month Subscription plan at GH₵500.00 as a single upfront payment. Everything is included — barcode POS, inventory Stock Book, receipt printing, staff accounts, and reports.',
  },
  {
    q: 'Is there automatic recurring billing?',
    a: 'No. Your GH₵500.00 payment is a single upfront payment covering 6 calendar months from activation. Nothing is deducted automatically after 6 months — you choose when to renew manually.',
  },
  {
    q: 'How do I pay and activate my shop?',
    a: 'Click PAY NOW on the Pricing page, sign in or create your SamTill customer account, and complete checkout securely with Paystack (Mobile Money or card). Once verified, your 6-month subscription activates immediately and you can open SamTill POS.',
  },
  {
    q: 'Can I install SamTill as an app?',
    a: 'Yes. SamTill runs as an installable Progressive Web App (PWA). Use the Install SamTill button in the navigation bar or visit Download for step-by-step instructions on Chrome, Microsoft Edge, Android, and iPhone/iPad.',
  },
  {
    q: 'What hardware do I need?',
    a: 'SamTill runs on Windows, Mac, tablet, or mobile browsers. For the checkout counter, it works with standard USB barcode scanners and thermal receipt printers (including Windows USB print bridge support).',
  },
  {
    q: 'Does it work for multiple staff?',
    a: 'Yes. Shop owners get full analytics and inventory management, while cashiers sign into their fast till terminal using staff PIN codes.',
  },
  {
    q: 'What happens to my business data?',
    a: 'Your shop inventory, sales, and customer records live in your isolated multi-tenant workspace backed by PostgreSQL Row-Level Security and real-time cloud sync.',
  },
];

export default function Faq() {
  return (
    <section id="faq" className="bg-navy-950 py-20 lg:py-28">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <p className="text-sm font-bold uppercase tracking-widest text-amber-400">
            Frequently asked questions
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Answers before you get started
          </h2>
        </Reveal>

        <div className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-2">
          {FAQS.map((item, index) => (
            <Reveal key={item.q} delayMs={index * 50}>
              <details className="group h-full rounded-xl border border-navy-700 bg-navy-900/60 transition-colors open:border-amber-500/50">
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
