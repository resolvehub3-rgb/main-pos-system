import React, {useEffect, useRef, useState} from 'react';
import {CustomerDisplayModal} from './CustomerDisplayModal';
import {
  announceDisplayClosed,
  pingCustomerDisplay,
  sessionIdFromSearch,
  subscribeCustomerDisplay,
  DISPLAY_PING_INTERVAL_MS,
} from '../lib/customerDisplayChannel';
import type {CustomerDisplayState} from '../types';

/** A display with no state for this long reports "Waiting for the till…". */
const LINK_TIMEOUT_MS = DISPLAY_PING_INTERVAL_MS * 2 + 1000;

/**
 * Root component of the customer display POPUP window (browser/PWA).
 *
 * Rendered when a window loads `/?view=customer-display` (with the till's
 * `sid` so the channel is scoped to that one cashier session). The cashier
 * opens it with the "Customer Display" button (window.open — first open needs
 * a user gesture) and the app tries to place it on monitor 2; the operator
 * can drag it there when the browser refuses to move it.
 *
 * It:
 *  - requests the current sale on load (also after a reload) and re-pings
 *    every few seconds, so it always mirrors the *latest* cart and can tell
 *    whether the till is still there,
 *  - live-updates on every scan/quantity change/removal/sale completion the
 *    cashier publishes over BroadcastChannel (src/lib/customerDisplayChannel),
 *  - shows the existing welcome screen while no sale is active and the
 *    payment confirmation after the till's checkout succeeds,
 *  - has NO close (X) button: this is the customer's screen, so only the
 *    operator closes it, with the popup window's own close control (the
 *    cashier window notices via its `popup.closed` poll),
 *  - offers one click to go full-screen on the customer monitor (browsers
 *    require a gesture in this window, so it is a button, never a hack).
 *
 * It deliberately imports no database, auth or business logic — the cashier
 * window stays the single source of truth for the cart.
 */
export const CustomerDisplayWindow: React.FC = () => {
  const [state, setState] = useState<CustomerDisplayState | null>(null);
  const [linkLive, setLinkLive] = useState(false);
  const lastStateAtRef = useRef<number>(0);
  // One session id for this window's whole life (read once from the URL).
  const sessionRef = useRef<string | null>(
    typeof window !== 'undefined' ? sessionIdFromSearch(window.location.search) : null,
  );

  useEffect(() => {
    const sessionId = sessionRef.current;

    // The subscribe call announces this window, so the cashier replies with
    // the current cart even if it changed before we were listening.
    const unsubscribe = subscribeCustomerDisplay((next) => {
      lastStateAtRef.current = Date.now();
      setLinkLive(true);
      setState(next);
    }, sessionId);

    // Heartbeat: keeps the till's copy fresh (a cashier window that just
    // reloaded answers with the current cart) and proves the link is alive.
    const ping = window.setInterval(() => {
      pingCustomerDisplay(sessionId);
    }, DISPLAY_PING_INTERVAL_MS);

    // Re-evaluate the link indicator on the same cadence.
    const linkCheck = window.setInterval(() => {
      setLinkLive(Date.now() - lastStateAtRef.current < LINK_TIMEOUT_MS);
    }, 2000);

    const unsubscribeFullscreen = () => {};

    return () => {
      announceDisplayClosed(sessionId);
      unsubscribe();
      unsubscribeFullscreen();
      window.clearInterval(ping);
      window.clearInterval(linkCheck);
    };
  }, []);


  return (
    <CustomerDisplayModal
      state={{
        tenantName: state?.tenantName || 'SamTill POS',
        ...(state?.tenantLogo ? {tenantLogo: state.tenantLogo} : {}),
        items: state?.items ?? [],
        subtotal: state?.subtotal ?? 0,
        discountTotal: state?.discountTotal ?? 0,
        taxTotal: state?.taxTotal ?? 0,
        totalAmount: state?.totalAmount ?? 0,
        ...(state?.payment ? {payment: state.payment} : {}),
      }}
      linkLive={linkLive}
    />
  );
};
