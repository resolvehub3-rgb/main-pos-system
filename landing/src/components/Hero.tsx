import {Reveal} from './Reveal';

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-navy-950">
      {/* Subtle radial glow — decorative only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 top-0 h-[520px] w-[520px] rounded-full bg-amber-600/15 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
        <div>
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-navy-600 bg-navy-800/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-amber-300">
              Supermarket &amp; retail point of sale
            </p>
          </Reveal>

          <Reveal delayMs={80}>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl 2xl:text-6xl">
              Run Your Shop.
              <br />
              <span className="text-amber-400">Know Your Numbers.</span>
            </h1>
          </Reveal>

          <Reveal delayMs={160}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-navy-100">
              SamTill is a point-of-sale application for supermarkets and retail shops in Ghana.
              Scan barcodes at the till, keep your product catalogue and stock movement in one
              place, print customer receipts, and see daily sales and profit reports without
              spreadsheets.
            </p>
          </Reveal>

          <Reveal delayMs={240}>
            <div className="mt-9 flex flex-col gap-4 sm:flex-row">
              <a
                href="#pricing"
                className="inline-flex items-center justify-center rounded-full bg-amber-700 px-8 py-4 text-base font-bold text-white shadow-lg shadow-amber-700/30 transition-colors hover:bg-amber-800"
              >
                View packages
              </a>
              <a
                href="#contact"
                className="inline-flex items-center justify-center rounded-full border-2 border-navy-500 px-8 py-4 text-base font-bold text-white transition-colors hover:border-amber-400 hover:text-amber-400"
              >
                Contact the business
              </a>
            </div>
          </Reveal>

          <Reveal delayMs={320}>
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-navy-200">
              {['Barcode checkout', 'Receipt printing', 'Stock & sales reports'].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    width="16"
                    height="16"
                    fill="currentColor"
                    className="text-amber-400"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delayMs={200} className="lg:pl-4">
          <figure className="relative">
            <div className="overflow-hidden rounded-2xl border border-navy-700 bg-navy-900 shadow-2xl shadow-black/40">
              <div className="flex items-center gap-2 border-b border-navy-700 bg-navy-800 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-amber-500/80" aria-hidden="true" />
                <span className="h-3 w-3 rounded-full bg-navy-500" aria-hidden="true" />
                <span className="h-3 w-3 rounded-full bg-navy-500" aria-hidden="true" />
                <span className="ml-3 text-xs font-medium text-navy-300">SamTill — Shop Owner Dashboard</span>
              </div>
              <img
                src="/assets/screenshot-dashboard.png"
                alt="SamTill shop owner dashboard showing today's sales, orders, profit, a sales trend chart and top-selling products."
                width={1920}
                height={987}
                className="h-auto w-full"
                loading="eager"
                decoding="async"
              />
            </div>
            <figcaption className="mt-3 text-center text-xs text-navy-300">
              Screenshot of the actual SamTill application.
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
