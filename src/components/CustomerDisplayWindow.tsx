import React, {useEffect, useState} from 'react';
import {CustomerDisplayModal} from './CustomerDisplayModal';
import {
  announceDisplayClosed,
  subscribeCustomerDisplay,
} from '../lib/customerDisplayChannel';
import type {CustomerDisplayState} from '../types';

/**
 * Root component of the customer display POPUP window (browser/PWA).
 *
 * Rendered when a window loads `/?view=customer-display`. The cashier opens
 * it with the "Customer Display" button (window.open — must be a user
 * gesture) and drags it to the customer-facing screen. It:
 *  - requests the current sale on load (also after a reload),
 *  - live-updates on every scan/quantity change/removal/sale completion the
 *    cashier publishes over BroadcastChannel (src/lib/customerDisplayChannel),
 *  - shows the existing welcome screen while no sale is active,
 *  - closes its own window when the operator clicks the X.
 *
 * It deliberately imports no database, auth or business logic — the cashier
 * window stays the single source of truth for the cart.
 */
export const CustomerDisplayWindow: React.FC = () => {
  const [state, setState] = useState<CustomerDisplayState | null>(null);

  useEffect(() => {
    // The subscribe call announces this window, so the cashier replies with
    // the current cart even if it changed before we were listening.
    const unsubscribe = subscribeCustomerDisplay((next) => setState(next));
    return () => {
      announceDisplayClosed();
      unsubscribe();
    };
  }, []);

  return (
    <CustomerDisplayModal
      tenantName={state?.tenantName || 'SamTill POS'}
      items={state?.items ?? []}
      totalAmount={state?.totalAmount ?? 0}
      onClose={() => window.close()}
    />
  );
};
