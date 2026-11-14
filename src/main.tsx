import {Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import LandingApp from '../landing/src/App.tsx';
import {applyStandaloneTitle, initInstallPrompt, registerServiceWorker} from './lib/pwa.ts';
import {isPosAppPath, legacyPosRedirect} from './lib/roleRoute.ts';
import './index.css';
import '../landing/src/index.css';

const App = lazy(() => import('./App.tsx'));
const CustomerDisplayWindow = lazy(() =>
  import('./components/CustomerDisplayWindow.tsx').then((m) => ({default: m.CustomerDisplayWindow})),
);
const SplashScreen = lazy(() =>
  import('./components/SplashScreen.tsx').then((m) => ({default: m.SplashScreen})),
);

/**
 * Root dispatcher separating:
 *   1. Dual-screen customer display popup (`/?view=customer-display`)
 *   2. POS Application (PWA) strictly inside `/app/*` (with automatic
 *      replacement of legacy POS paths `/login`, `/register`, `/admin`,
 *      `/shop-owner`, `/cashier`, `/dashboard`, `/pos` -> `/app/*`)
 *   3. Public Marketing Website & Billing Portal (`/`, `/features`,
 *      `/pricing`, `/about`, `/contact`, `/download`, `#/...`).
 *
 * POS modules (and the POS Supabase Realtime engine) are lazy-loaded ONLY when
 * rendering `/app/*` or `?view=customer-display`, keeping the marketing website
 * isolated and free of POS database side effects.
 */
registerServiceWorker();
initInstallPrompt();
applyStandaloneTitle();

if (typeof window !== 'undefined') {
  const redirectTarget = legacyPosRedirect(window.location.pathname);
  if (redirectTarget) {
    window.history.replaceState(
      {},
      '',
      redirectTarget + window.location.search + window.location.hash,
    );
  }
}

const isCustomerDisplayView =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('view') === 'customer-display';

const isPosRoute =
  typeof window !== 'undefined' && isPosAppPath(window.location.pathname);

function PosLoadingFallback() {
  return (
    <div className="min-h-screen bg-[#0D213B] flex items-center justify-center text-white text-sm font-medium">
      Loading SamTill POS...
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  isCustomerDisplayView ? (
    <Suspense fallback={<PosLoadingFallback />}>
      <CustomerDisplayWindow />
    </Suspense>
  ) : isPosRoute ? (
    <Suspense fallback={<PosLoadingFallback />}>
      <App />
      <SplashScreen />
    </Suspense>
  ) : (
    <LandingApp />
  ),
);
