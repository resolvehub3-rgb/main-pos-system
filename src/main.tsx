import {Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import {SplashScreen} from './components/SplashScreen.tsx';
import {applyStandaloneTitle, initInstallPrompt, registerServiceWorker} from './lib/pwa.ts';
import {isPosPath} from './lib/roleRoute.ts';
import './index.css';
import '../landing/src/index.css';

const App = lazy(() => import('./App.tsx'));
const LandingApp = lazy(() => import('../landing/src/App.tsx'));
const CustomerDisplayWindow = lazy(() =>
  import('./components/CustomerDisplayWindow.tsx').then((mod) => ({
    default: mod.CustomerDisplayWindow,
  })),
);

/**
 * Application entry point separating:
 *  1. Customer Display popup (`?view=customer-display`)
 *  2. SamTill POS Application (`/app/*` namespace + legacy POS aliases)
 *  3. Public Marketing Website (`/`, `/features`, `/pricing`, `/about`,
 *     `/contact`, `/download`)
 *
 * Route-level lazy imports ensure the public marketing website never executes
 * POS runtime modules (or initializes Supabase POS Realtime/Auth listeners),
 * and the POS application never mounts the marketing layout.
 * Installed PWAs launch at `start_url: "/app/login"` inside `scope: "/app/"`,
 * so they always enter the POS branch directly.
 */
registerServiceWorker();
initInstallPrompt();
applyStandaloneTitle();

const isCustomerDisplayView =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('view') === 'customer-display';
const isPosRoute =
  typeof window !== 'undefined' && isPosPath(window.location.pathname);

if (isPosRoute && typeof document !== 'undefined') {
  document.title = 'SamTill POS';
}

createRoot(document.getElementById('root')!).render(
  isCustomerDisplayView ? (
    <Suspense fallback={null}>
      <CustomerDisplayWindow />
    </Suspense>
  ) : isPosRoute ? (
    <>
      <Suspense fallback={null}>
        <App />
      </Suspense>
      <SplashScreen />
    </>
  ) : (
    <Suspense fallback={null}>
      <LandingApp />
    </Suspense>
  ),
);
