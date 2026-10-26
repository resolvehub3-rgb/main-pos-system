import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CustomerDisplayWindow} from './components/CustomerDisplayWindow.tsx';
import './index.css';

/**
 * The desktop app's customer display window loads `/?view=customer-display`
 * (set by the Electron main process) and renders only the customer-facing
 * root. Everything else — including the browser/PWA entry point — is the
 * existing App exactly as before.
 */
const isCustomerDisplayView =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('view') === 'customer-display';

createRoot(document.getElementById('root')!).render(
  isCustomerDisplayView ? <CustomerDisplayWindow /> : <App />,
);
