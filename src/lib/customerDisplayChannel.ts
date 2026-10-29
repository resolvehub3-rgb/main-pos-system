import type {CustomerDisplayState} from '../types';

/**
 * Browser customer-display sync (BroadcastChannel).
 *
 * Replaces the Electron IPC bridge that used to push the cart to a native
 * second-monitor window. The cashier window opens a dedicated popup
 * (`/?view=customer-display`) which the operator drags to the customer
 * screen; both windows live in the same origin, so a BroadcastChannel
 * carries the projected cart state between them.
 *
 * Protocol (same channel name in both windows):
 *  - display → cashier: `{type: 'request-state'}` once it is listening, so a
 *    display that opened late (or was reloaded) gets the current cart,
 *  - cashier → display: `{type: 'state', state}` on every cart change and in
 *    answer to a request,
 *  - display → cashier: `{type: 'closed'}` on unmount so the cashier stops
 *    tracking the window handle.
 *
 * Limitations vs the old desktop window (browser platform constraints):
 *  - the popup must be opened by a user gesture (a click) — browsers block
 *    unrequested windows, so it cannot auto-open at startup,
 *  - the browser chooses where the popup appears; the operator moves it to
 *    the second monitor once,
 *  - if popups are blocked the caller falls back to the in-page modal.
 *
 * Only the narrow customer projection (see src/lib/customerDisplay.ts) ever
 * crosses this channel — never product cost, stock or tenant internals.
 */
const CHANNEL_NAME = 'samtill-customer-display';

type DisplayMessage = {type: 'request-state'} | {type: 'closed'};
type CashierMessage = {type: 'state'; state: CustomerDisplayState | null};

/** BroadcastChannel is supported in every evergreen browser; guard anyway. */
function openChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

/* -------------------------------------------------------------------------- */
/* Cashier window side                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Listen for display-window pings and re-publish the current state on demand.
 *
 * `getState` is called at reply time so the answer always carries the cart as
 * it is *now* — not the cart at subscribe time. `onClosed` fires when the
 * display announces it is going away. Returns an unsubscribe fn.
 */
export function serveCustomerDisplay(
  getState: () => CustomerDisplayState | null,
  onClosed?: () => void,
): () => void {
  const channel = openChannel();
  if (!channel) return () => undefined;

  channel.onmessage = (event: MessageEvent<DisplayMessage>) => {
    if (event.data?.type === 'request-state') {
      publishCustomerDisplayState(getState());
    } else if (event.data?.type === 'closed') {
      onClosed?.();
    }
  };

  return () => channel.close();
}

/** Push the current cart projection to any open customer display window. */
export function publishCustomerDisplayState(state: CustomerDisplayState | null): void {
  const channel = openChannel();
  if (!channel) return;
  channel.postMessage({type: 'state', state} satisfies CashierMessage);
  // postMessage queues the message for delivery before close(), so this is
  // safe and avoids keeping a channel handle alive on every cart change.
  channel.close();
}

/** Tell any listening cashier window this display is gone. */
export function announceDisplayClosed(): void {
  const channel = openChannel();
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
export function subscribeCustomerDisplay(onState: (state: CustomerDisplayState | null) => void): () => void {
  const channel = openChannel();
  if (!channel) return () => undefined;

  channel.onmessage = (event: MessageEvent<CashierMessage>) => {
    if (event.data?.type === 'state') {
      onState(event.data.state);
    }
  };

  channel.postMessage({type: 'request-state'} satisfies DisplayMessage);

  return () => channel.close();
}
