import React, {useEffect, useState} from 'react';
import {CustomerDisplayModal} from './CustomerDisplayModal';
import {
  closeNativeCustomerDisplay,
  getCustomerDisplayState,
  isDesktop,
  onCustomerDisplayState,
} from '../lib/desktopBridge';
import type {CustomerDisplayState} from '../types';

/**
 * Root component of the native customer display window (Electron only).
 *
 * Rendered when the window loads `/?view=customer-display`. It:
 *  - restores the last state the cashier pushed (also after a reload),
 *  - live-updates on every scan/quantity change/removal/sale completion the
 *    cashier pushes over IPC,
 *  - shows the existing welcome screen while no sale is active,
 *  - closes the native window through IPC when the operator clicks the X.
 *
 * It deliberately imports no database, auth or business logic — the cashier
 * window stays the single source of truth for the cart.
 */
export const CustomerDisplayWindow: React.FC = () => {
  const [state, setState] = useState<CustomerDisplayState | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;

    // Restore the current sale (covers window opening late and reloads).
    getCustomerDisplayState()
      .then((s) => {
        if (!cancelled && s) setState(s);
      })
      .catch(() => undefined);

    const unsubscribe = onCustomerDisplayState((next) => setState(next));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <CustomerDisplayModal
      tenantName={state?.tenantName || 'SamTill POS'}
      items={state?.items ?? []}
      totalAmount={state?.totalAmount ?? 0}
      onClose={() => closeNativeCustomerDisplay()}
    />
  );
};
