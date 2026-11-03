import type {CustomerDisplayState} from '../types';

/**
 * Browser customer-display sync (BroadcastChannel).
 *
 * Replaces the Electron IPC bridge that used to push the cart to a native
 * second-monitor window. The cashier window opens a dedicated popup
 * (`/?view=customer-display&sid=…`) which the operator drags to the customer
 * screen; both windows live in the same origin, so a BroadcastChannel
 * carries the projected cart state between them.
 *
 * Protocol (same channel name in both windows):
 *  - display → cashier: `{type: 'request-state'}` once it is listening and
 *    then periodically, so a display that opened late (or was reloaded) gets
 *    the current cart AND so the cashier can tell the display is still alive,
 *  - cashier → display: `{type: 'state', state}` on every cart change and in
 *    answer to a request,
 *  - display → cashier: `{type: 'closed'}` on unmount so the cashier stops
 *    tracking the window handle.
 *
 * Session scoping: the channel name is suffixed with the till's own
 * `tenant:user` session id (see {@link customerDisplayChannelName}), so two
 * cashiers signed in on the same machine never see each other's checkout.
 * The id travels in the popup URL as `sid` — it is an identifier, not a
 * credential: the popup renders the narrow customer projection only and has
 * no access to the cashier session, and every sale still goes through the
 * authenticated Supabase session + RLS on the cashier side.
 *
 * Limitations vs the old desktop window (browser platform constraints):
 *  - the popup must be opened by a user gesture (a click) the first time —
 *    browsers block unrequested windows, so it cannot auto-open until the
 *    browser has granted popups for this origin once,
 *  - the browser chooses where the popup appears; the operator moves it to
 *    the second monitor once (or the app positions it when the browser lets it),
 *  - if popups are blocked the caller falls back to the in-page modal.
 *
 * Only the narrow customer projection (see src/lib/customerDisplay.ts) ever
 * crosses this channel — never product cost, stock or tenant internals.
 */
const BASE_CHANNEL_NAME = 'samtill-customer-display';

/** Channel suffix identifying one till session: `${tenantId}:${userId}`. */
export type CustomerDisplaySessionId = string;

/**
 * The BroadcastChannel name for a till session.
 *
 * No session id → the legacy unscoped name (used when the URL carries no
 * `sid`, e.g. a customer display opened by hand).
 */
export function customerDisplayChannelName(
  sessionId?: CustomerDisplaySessionId | null,
): string {
  return sessionId ? `${BASE_CHANNEL_NAME}:${sessionId}` : BASE_CHANNEL_NAME;
}

/** Read the session id back out of the popup's query string. */
export function sessionIdFromSearch(search: string): CustomerDisplaySessionId | null {
  const sid = new URLSearchParams(search).get('sid');
  return sid && sid.trim() ? sid.trim() : null;
}

type DisplayMessage = {type: 'request-state'} | {type: 'closed'};
type CashierMessage = {type: 'state'; state: CustomerDisplayState | null};

/** How often the display re-announces itself (also its liveness heartbeat). */
export const DISPLAY_PING_INTERVAL_MS = 3000;

/** BroadcastChannel is supported in every evergreen browser; guard anyway. */
function openChannel(sessionId?: CustomerDisplaySessionId | null): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(customerDisplayChannelName(sessionId));
}

/* -------------------------------------------------------------------------- */
/* Cashier window side                                                         */
/* -------------------------------------------------------------------------- */

export interface ServeHandlers {
  /** The display announced it is going away (its window closed). */
  onClosed?: () => void;
  /**
   * The display pinged: it is alive and listening. Used to drive the
   * "customer display connected" status on the cashier UI.
   */
  onAlive?: () => void;
}

/**
 * Listen for display-window pings and re-publish the current state on demand.
 *
 * `getState` is called at reply time so the answer always carries the cart as
 * it is *now* — not the cart at subscribe time. Returns an unsubscribe fn.
 */
export function serveCustomerDisplay(
  getState: () => CustomerDisplayState | null,
  sessionId?: CustomerDisplaySessionId | null,
  handlers?: ServeHandlers,
): () => void {
  const channel = openChannel(sessionId);
  if (!channel) return () => undefined;

  channel.onmessage = (event: MessageEvent<DisplayMessage>) => {
    if (event.data?.type === 'request-state') {
      handlers?.onAlive?.();
      publishCustomerDisplayState(getState(), sessionId);
    } else if (event.data?.type === 'closed') {
      handlers?.onClosed?.();
    }
  };

  return () => channel.close();
}

/** Push the current cart projection to any open customer display window. */
export function publishCustomerDisplayState(
  state: CustomerDisplayState | null,
  sessionId?: CustomerDisplaySessionId | null,
): void {
  const channel = openChannel(sessionId);
  if (!channel) return;
  channel.postMessage({type: 'state', state} satisfies CashierMessage);
  // postMessage queues the message for delivery before close(), so this is
  // safe and avoids keeping a channel handle alive on every cart change.
  channel.close();
}

/** Tell any listening cashier window this display is gone. */
export function announceDisplayClosed(sessionId?: CustomerDisplaySessionId | null): void {
  const channel = openChannel(sessionId);
  if (!channel) return;
  channel.postMessage({type: 'closed'} satisfies DisplayMessage);
  channel.close();
}

/* -------------------------------------------------------------------------- */
/* Customer display window side                                                */
/* -------------------------------------------------------------------------- */

/**
 * Subscribe to cart updates in the customer display window.
 *
 * Announces itself with `request-state` so the opener replies with the
 * current cart even if the display opened after the last change. Returns an
 * unsubscribe function.
 */
export function subscribeCustomerDisplay(
  onState: (state: CustomerDisplayState | null) => void,
  sessionId?: CustomerDisplaySessionId | null,
): () => void {
  const channel = openChannel(sessionId);
  if (!channel) return () => undefined;

  channel.onmessage = (event: MessageEvent<CashierMessage>) => {
    if (event.data?.type === 'state') {
      onState(event.data.state);
    }
  };

  channel.postMessage({type: 'request-state'} satisfies DisplayMessage);

  return () => channel.close();
}

/**
 * One liveness ping from the display to the cashier (also re-requests the
 * current cart, so a cashier window that just reloaded republishes its state).
 * Called on an interval by CustomerDisplayWindow.
 */
export function pingCustomerDisplay(sessionId?: CustomerDisplaySessionId | null): void {
  const channel = openChannel(sessionId);
  if (!channel) return;
  channel.postMessage({type: 'request-state'} satisfies DisplayMessage);
  channel.close();
}
