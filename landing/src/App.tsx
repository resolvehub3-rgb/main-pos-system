import {useEffect} from 'react';
import {initInstallPrompt} from '../../src/lib/pwa';
import About from './components/About';
import Contact from './components/Contact';
import DownloadSection from './components/DownloadSection';
import Faq from './components/Faq';
import Features from './components/Features';
import Footer from './components/Footer';
import Hero from './components/Hero';
import Nav from './components/Nav';
import Pricing from './components/Pricing';
import Screenshots from './components/Screenshots';
import AccountPage from './pages/AccountPage';
import AdminPage from './pages/AdminPage';
import CheckoutPage from './pages/CheckoutPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import {isAccountRoute, type AccountRoute, type ParsedRoute} from './lib/hashRoute';
import {navigateTo} from './lib/navigation';
import {useHashRoute} from './lib/useHashRoute';

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

function renderMarketingView(path: string) {
  switch (path) {
    case '/features':
      return (
        <>
          <Features />
          <Screenshots />
        </>
      );
    case '/pricing':
      return (
        <>
          <Pricing />
          <Faq />
        </>
      );
    case '/about':
      return (
        <>
          <About />
          <Faq />
        </>
      );
    case '/contact':
      return <Contact />;
    case '/download':
      return <DownloadSection />;
    default:
      return (
        <>
          <Hero />
          <Features />
          <Screenshots />
          <Pricing />
          <About />
          <Faq />
          <Contact />
        </>
      );
  }
}

export default function App() {
  const route = useHashRoute();
  const accountScreen = isAccountRoute(route.path)
    ? (route as ParsedRoute & {path: AccountRoute})
    : null;

  useEffect(() => {
    initInstallPrompt();
  }, []);

  useEffect(() => {
    window.scrollTo({top: 0});
  }, [route.path]);

  // Fold Paystack's return URL (`/?checkout=return&reference=...`) into `#/checkout?reference=...`.
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

      <Nav />

      <main id="main">
        {accountScreen ? renderAccountScreen(accountScreen) : renderMarketingView(route.path)}
      </main>

      <Footer />
    </>
  );
}
