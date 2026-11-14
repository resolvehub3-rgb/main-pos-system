import {useCallback, useEffect, useState} from 'react';
import Contact from './components/Contact';
import Faq from './components/Faq';
import Features from './components/Features';
import Footer from './components/Footer';
import Hero from './components/Hero';
import Nav from './components/Nav';
import Pricing from './components/Pricing';
import Screenshots from './components/Screenshots';
import AboutPage from './pages/AboutPage';
import AccountPage from './pages/AccountPage';
import AdminPage from './pages/AdminPage';
import CheckoutPage from './pages/CheckoutPage';
import DownloadPage from './pages/DownloadPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import {isAccountRoute, type AccountRoute, type ParsedRoute} from './lib/hashRoute';
import {
  marketingPageTitle,
  navigateMarketing,
  normalizeMarketingPath,
  type MarketingRoute,
} from './lib/marketingRoute';
import {navigateTo} from './lib/navigation';
import {useHashRoute} from './lib/useHashRoute';

/**
 * Public marketing website shell.
 *
 * Strictly separated from the SamTill POS application (`/app/*`), with
 * dedicated public routes:
 *   /           → Marketing homepage
 *   /features   → Product features & screenshots
 *   /pricing    → 6-Month Subscription pricing
 *   /about      → About SamTill & onboarding
 *   /contact    → Contact & enquiry
 *   /download   → Smart PWA installation & platform instructions
 *
 * Legacy hash-routed `#/...` customer account screens remain preserved.
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
    case '/admin':
      return <AdminPage />;
  }
}

export default function App() {
  const route = useHashRoute();
  const accountScreen = isAccountRoute(route.path)
    ? (route as ParsedRoute & {path: AccountRoute})
    : null;

  const [marketingRoute, setMarketingRoute] = useState<MarketingRoute>(() =>
    typeof window !== 'undefined' ? normalizeMarketingPath(window.location.pathname) : '/',
  );

  useEffect(() => {
    const syncPath = () => {
      setMarketingRoute(normalizeMarketingPath(window.location.pathname));
    };
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  useEffect(() => {
    if (!accountScreen && typeof document !== 'undefined') {
      document.title = marketingPageTitle(marketingRoute);
    }
  }, [accountScreen, marketingRoute]);

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
    const reference = route.params.get('reference') ?? route.params.get('trxref');
    if (!reference) return;
    window.history.replaceState({}, '', window.location.pathname);
    navigateTo(`/checkout?reference=${encodeURIComponent(reference)}`);
  }, [route]);

  const handleNavigate = useCallback((path: string) => {
    navigateMarketing(path);
    if (!path.startsWith('/app') && !path.startsWith('#')) {
      setMarketingRoute(normalizeMarketingPath(path));
    }
  }, []);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-navy-900 focus:shadow-lg"
      >
        Skip to main content
      </a>

      <Nav currentRoute={marketingRoute} onNavigate={handleNavigate} />

      <main id="main">
        {accountScreen ? (
          renderAccountScreen(accountScreen)
        ) : marketingRoute === '/features' ? (
          <>
            <Features />
            <Screenshots />
          </>
        ) : marketingRoute === '/pricing' ? (
          <Pricing isStandalonePage />
        ) : marketingRoute === '/about' ? (
          <AboutPage onNavigate={handleNavigate} />
        ) : marketingRoute === '/contact' ? (
          <Contact />
        ) : marketingRoute === '/download' ? (
          <DownloadPage onNavigate={handleNavigate} />
        ) : (
          <>
            <Hero onNavigate={handleNavigate} />
            <Features />
            <Screenshots />
            <Pricing />
            <Faq />
            <Contact />
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
