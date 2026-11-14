import Faq from '../components/Faq';
import HowItWorks from '../components/HowItWorks';
import {Reveal} from '../components/Reveal';
import {SITE} from '../config/site';
import {navigateMarketing} from '../lib/marketingRoute';

interface AboutPageProps {
  onNavigate?: (path: string) => void;
}

export default function AboutPage({onNavigate}: AboutPageProps) {
  const go = (path: string) => {
    if (onNavigate) onNavigate(path);
    else navigateMarketing(path);
  };

  return (
    <>
      <section className="bg-navy-950 py-16 text-white lg:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <p className="text-sm font-bold uppercase tracking-widest text-amber-400">
              About {SITE.brand}
            </p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">
              Built for Ghanaian Supermarkets &amp; Retail Shops
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-relaxed text-navy-100">
              {SITE.brand} is developed by {SITE.company} to give retail shop owners fast barcode
              checkout, reliable offline continuity, real-time stock movement books, and accurate
              daily sales &amp; profit visibility without spreadsheet guesswork.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="/download"
                onClick={(event) => {
                  event.preventDefault();
                  go('/download');
                }}
                className="inline-flex items-center justify-center rounded-full bg-amber-700 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
              >
                Install SamTill POS
              </a>
              <a
                href="/app/login"
                className="inline-flex items-center justify-center rounded-full border-2 border-navy-500 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:border-amber-400 hover:text-amber-300"
              >
                Open POS Login
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      <HowItWorks />
      <Faq />
    </>
  );
}
