import {Reveal} from './Reveal';

const STEPS = [
  {
    title: 'Enquire',
    body: 'Contact SamTeck Digital and tell us about your shop — what you sell, how many people use the till, and how you take payment today.',
  },
  {
    title: 'Select a package',
    body: 'We agree on the right package for your shop and confirm the price and licence terms in writing before anything is paid.',
  },
  {
    title: 'Arrange setup',
    body: 'SamTeck Digital installs SamTill on your computer, loads your products and prices, and sets up your printer with your staff.',
  },
  {
    title: 'Activate the licence',
    body: 'Once the commercial licensing system is ready, your licence is activated and your included six-month support period begins.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-700">How it works</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
            From first conversation to a running till
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            No online signup, no self-service checkout. Every shop is set up personally.
          </p>
        </Reveal>

        <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delayMs={index * 90} as="li" className="h-full">
              <div className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-7">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-navy-900 text-base font-extrabold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-5 text-lg font-bold text-navy-900">{step.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
