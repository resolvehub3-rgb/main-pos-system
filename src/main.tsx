import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CustomerDisplayWindow} from './components/CustomerDisplayWindow.tsx';
import {SplashScreen} from './components/SplashScreen.tsx';
import './index.css';

/**
 * The desktop app's customer display window loads `/?view=customer-display`
 * (set by the Electron main process) and renders only the customer-facing
 * root. Everything else — including the browser/PWA entry point — is the
 * existing App exactly as before.
 *
 * The main entry opens with the branded splash screen, which fades out to
 * reveal either the login tab (no session) or the dashboard (session already
 * restored). The customer display never shows a splash — it must come up
 * straight onto the customer-facing view.
 */
const isCustomerDisplayView =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('view') === 'customer-display';

createRoot(document.getElementById('root')!).render(
  isCustomerDisplayView ? (
    <CustomerDisplayWindow />
  ) : (
    <>
      <App />
      <SplashScreen />
    </>
  ),
);
