import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import LandingApp from '../landing/src/App.tsx';
import {CustomerDisplayWindow} from './components/CustomerDisplayWindow.tsx';
import {SplashScreen} from './components/SplashScreen.tsx';
import {applyStandaloneTitle, initInstallPrompt, registerServiceWorker} from './lib/pwa.ts';
import {isAuthEntryPath, WORKSPACE_PATHS} from './lib/roleRoute.ts';
import './index.css';
import '../landing/src/index.css';

/**
 * The customer display popup window loads `/?view=customer-display` (opened
 * by the cashier's "Customer Display" button) and renders only the
 * customer-facing root. Everything else — including the normal PWA entry
 * point — is the existing App exactly as before.
 *
 * The main entry opens with the branded splash screen, which fades out to
 * reveal either the login tab (no session) or the dashboard (session already
 * restored). The customer display never shows a splash — it must come up
 * straight onto the customer-facing view.
 *
 * PWA plumbing: the service worker is registered once (production only) and
 * the browser install prompt is captured so the header can offer a real
 * "Install app" button (src/lib/pwa.ts). When running as an installed app,
 * the window title is shortened to "SamTill POS" before first render so the
 * standalone title bar shows the app name instead of the SEO page title.
 */
registerServiceWorker();
initInstallPrompt();
applyStandaloneTitle();

const isCustomerDisplayView =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('view') === 'customer-display';
const isPosRoute =
  typeof window !== 'undefined' &&
  // Auth entry points (/login, /register) plus the per-role workspaces
  // (/admin, /shop-owner, /cashier — see src/lib/roleRoute.ts).
  (isAuthEntryPath(window.location.pathname) ||
    WORKSPACE_PATHS.includes(window.location.pathname));

createRoot(document.getElementById('root')!).render(
  isCustomerDisplayView ? <CustomerDisplayWindow /> : isPosRoute ? (
    <>
      <App />
      <SplashScreen />
    </>
  ) : (
    <LandingApp />
  ),
);
