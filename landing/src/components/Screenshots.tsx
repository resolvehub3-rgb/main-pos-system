import {Reveal} from './Reveal';

const SCREENSHOTS = [
  {
    src: '/assets/screenshot-pos.png',
    alt: 'SamTill cashier POS workstation showing a barcode search field, product grid with prices and an empty current sale panel.',
    title: 'Cashier POS workstation',
    caption: 'Barcode search, product grid and the live sale panel where cash, MoMo and card are taken.',
  },
  {
    src: '/assets/screenshot-stockbook.png',
    alt: 'SamTill stock book screen with reporting period filters, closing stock value in cedis and a combined stock book table.',
    title: 'Stock Book',
    caption: 'Opening stock, received, sales, returns and adjustments per product, with PDF and print export.',
  },
  {
    src: '/assets/screenshot-dashboard.png',
    alt: 'SamTill shop owner dashboard with today\'s sales, orders, profit, a sales trend chart and inventory alerts.',
    title: 'Shop owner dashboard',
    caption: 'Today\'s sales, orders and profit at a glance, with top sellers and low-stock alerts.',
  },
];

export default function Screenshots() {
  return (
    <section className="bg-navy-950 py-20 lg:py-28" aria-labelledby="screenshots-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-400">The software</p>
          <h2
            id="screenshots-heading"
            className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl"
          >
            Straight from the SamTill application
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-navy-200">
            Real screenshots of the running product. No mock-ups, no retouching.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {SCREENSHOTS.map((shot, index) => (
            <Reveal key={shot.title} delayMs={index * 90} as="figure" className="h-full">
              <div className="overflow-hidden rounded-xl border border-navy-700 bg-navy-900">
                <img
                  src={shot.src}
                  alt={shot.alt}
                  width={1920}
                  height={987}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full"
                />
              </div>
              <figcaption className="mt-4">
                <h3 className="text-base font-bold text-white">{shot.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-navy-300">{shot.caption}</p>
              </figcaption>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
