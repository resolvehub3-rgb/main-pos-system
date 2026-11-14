import {Reveal} from './Reveal';
import {SITE} from '../config/site';
import {navigateRoute} from '../lib/navigation';

export default function About() {
  return (
    <section id="about" className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <p className="text-sm font-bold uppercase tracking-widest text-amber-700">About SamTill</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
              Built in Ghana by {SITE.company} for real shop floors
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-600">
              {SITE.brand} is developed by {SITE.company} in Mamprobi, Accra. It is built for
              supermarkets, pharmacies, minimarts, and retail stores that need reliable barcode
              checkout, clear stock visibility, and accurate profit figures at the end of every
              trading day.
            </p>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Instead of forcing shop owners onto complicated enterprise software or juggling
              spreadsheets, {SITE.brand} combines a dedicated Cashier Till, Shop Owner Dashboard,
              Stock Book ledger, thermal receipt printing, and offline-resilient browser storage
              into one clean web application you can install directly onto your till computers and
              phones.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="/pricing"
                onClick={(event) => {
                  event.preventDefault();
                  navigateRoute('/pricing');
                }}
                className="inline-flex items-center rounded-full bg-amber-700 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-800"
              >
                View 6-Month Plan — GH₵500.00
              </a>
              <a
                href="/download"
                onClick={(event) => {
                  event.preventDefault();
                  navigateRoute('/download');
                }}
                className="inline-flex items-center rounded-full border-2 border-navy-900 px-6 py-3 text-sm font-bold text-navy-900 transition-colors hover:border-amber-600 hover:text-amber-700"
              >
                Install &amp; Download Guide
              </a>
            </div>
          </Reveal>

          <Reveal delayMs={120}>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                {
                  title: 'Isolated Shop Workspaces',
                  body: 'Every business gets its own multi-tenant database workspace with row-level data isolation.',
                },
                {
                  title: 'Cashier & Owner Separation',
                  body: 'Cashiers work cleanly on the fast POS terminal with PIN access, while owners review profit and manage inventory.',
                },
                {
                  title: 'Works During Internet Drops',
                  body: 'Offline-first resilient architecture keeps active carts and till operations safe if shop Wi-Fi flickers.',
                },
                {
                  title: 'Simple 6-Month Pricing',
                  body: 'One straightforward GH₵500.00 upfront payment for 6 full months of POS access and updates — no surprise fees.',
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-6"
                >
                  <h3 className="text-base font-extrabold text-navy-900">{card.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{card.body}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
