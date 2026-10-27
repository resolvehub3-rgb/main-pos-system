import Comparison from './components/Comparison';
import Contact from './components/Contact';
import Faq from './components/Faq';
import Features from './components/Features';
import Footer from './components/Footer';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import Nav from './components/Nav';
import Pricing from './components/Pricing';
import Screenshots from './components/Screenshots';
import {SITE} from './config/site';

export default function App() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-navy-900 focus:shadow-lg"
      >
        Skip to main content
      </a>

      {!SITE.siteApprovedForLaunch && (
        <div className="bg-amber-500 px-4 py-2 text-center text-xs font-bold uppercase tracking-wider text-navy-950">
          {SITE.previewNotice}
        </div>
      )}

      <Nav />

      <main id="main">
        <Hero />
        <Features />
        <Screenshots />
        <Pricing />
        <Comparison />
        <HowItWorks />
        <Faq />
        <Contact />
      </main>

      <Footer />
    </>
  );
}
