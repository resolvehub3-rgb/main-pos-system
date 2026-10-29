import {useEffect} from 'react';
import Comparison from './components/Comparison';
import CommercePreview from './components/CommercePreview';
import Contact from './components/Contact';
import Faq from './components/Faq';
import Features from './components/Features';
import Footer from './components/Footer';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import Nav from './components/Nav';
import Pricing from './components/Pricing';
import Screenshots from './components/Screenshots';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import AccountPage from './pages/AccountPage';
import CheckoutPage from './pages/CheckoutPage';
import {SITE} from './config/site';
import {isAccountRoute, type AccountRoute, type ParsedRoute} from './lib/hashRoute';
import {navigateTo} from './lib/navigation';
import {useHashRoute} from './lib/useHashRoute';

/**
 * Single-page app shell.
 *
 * Marketing sections render for the home route and for plain section anchors
 * (`#features`, `#contact`, …). Hash routes that start with `#/` switch to
 * the customer account screens (register / verify / sign in / account /
 * checkout) without any server rewrite rules, so the static build
 * keeps working on any host.
 *
 * Paystack returns from its hosted page to `/?checkout=return&reference=…`
 * (a real query string, because the origin is fixed in APP_BASE_URL). That
 * is folded into the `#/checkout?reference=…` route below so the confirmation
 * screen owns the flow and a page refresh keeps working.
 */

function renderAccountScreen(route: ParsedRoute & {path: AccountRoute}) {
  switch (route.path) {
    case '/register':
      return <RegisterPage />;
    case '/login':
      return <LoginPage route={route} />;
    case '/verify':
      return <VerifyEmailPage route={route} />;
    case '/forgot-password':
      return <ForgotPasswordPage />;
    case '/reset-password':
      return <ResetPasswordPage route={route} />;
    case '/account':
      return <AccountPage />;
    case '/checkout':
      return <CheckoutPage />;
  }
}

export default function App() {
  const route = useHashRoute();
  const accountScreen = isAccountRoute(route.path) ? (route as ParsedRoute & {path: AccountRoute}) : null;

  // Always start an account screen at the top of the page.
  useEffect(() => {
    if (accountScreen) window.scrollTo({top: 0});
  }, [accountScreen?.path]);

  // Fold Paystack's return URL into the checkout route. replaceState keeps
  // the query string out of the address bar so a refresh does not restart
  // verification with a stale reference.
  useEffect(() => {
    if (route.path !== '/') return;
    if (route.params.get('checkout') !== 'return') return;
    const reference = route.params.get('reference');
    if (!reference) return;
    window.history.replaceState({}, '', window.location.pathname);
    navigateTo(`/checkout?reference=${encodeURIComponent(reference)}`);
  }, [route]);

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
        {accountScreen ? (
          renderAccountScreen(accountScreen)
        ) : (
          <>
            <Hero />
            <Features />
            <Screenshots />
            <Pricing />
            <Comparison />
            <HowItWorks />
            <Faq />
            <CommercePreview />
            <Contact />
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
