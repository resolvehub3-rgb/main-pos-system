/**
 * Live connection status of the customer-display window for THIS window.
 *
 * A tiny module-level store (same listener pattern as terminalSettings.ts)
 * so the status can be shown in the header, the till sidebar and the
 * Dual-Screen Setup panel without prop-drilling it through every component.
 *
 * Values:
 *  - `off`       — dual-screen mode is disabled in settings,
 *  - `not-open`  — no customer window is open (yet),
 *  - `connecting`— a window handle exists, no heartbeat received yet,
 *  - `connected` — the display pinged recently (it is alive and mirroring),
 *  - `blocked`   — the browser refused to open the window (popup blocker);
 *                  the till shows the one-click activation notice.
 */
import {useEffect, useState} from 'react';

export type CustomerDisplayConnection =
  | 'off'
  | 'not-open'
  | 'connecting'
  | 'connected'
  | 'blocked';

const listeners = new Set<(v: CustomerDisplayConnection) => void>();
let cache: CustomerDisplayConnection = 'not-open';

export function getCustomerDisplayConnection(): CustomerDisplayConnection {
  return cache;
}

export function setCustomerDisplayConnection(next: CustomerDisplayConnection): void {
  if (cache === next) return;
  cache = next;
  listeners.forEach((cb) => {
    try {
      cb(next);
    } catch (err) {
      console.warn('Customer display status listener error:', err);
    }
  });
}

export function subscribeCustomerDisplayConnection(
  cb: (v: CustomerDisplayConnection) => void,
): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: the live customer-display connection status. */
export function useCustomerDisplayConnection(): CustomerDisplayConnection {
  const [value, setValue] = useState<CustomerDisplayConnection>(cache);

  useEffect(() => {
    setValue(cache);
    return subscribeCustomerDisplayConnection(setValue);
  }, []);

  return value;
}

/** Short human label for a status value (used in chips and settings). */
export function customerDisplayConnectionLabel(
  status: CustomerDisplayConnection,
): string {
  switch (status) {
    case 'off':
      return 'Dual screen off';
    case 'not-open':
      return 'Customer display not open';
    case 'connecting':
      return 'Customer display connecting…';
    case 'connected':
      return 'Customer display connected';
    case 'blocked':
      return 'Customer display blocked by browser';
  }
}

export interface DeriveConnectionInput {
  /** Dual-screen mode enabled in settings. */
  enabled: boolean;
  /** Is the popup window handle still open? */
  hasWindow: boolean;
  /** The status shown right now. */
  current: CustomerDisplayConnection;
  /** `Date.now()` of the last heartbeat from the display (0 = never). */
  lastAliveAt: number;
  now: number;
  /** Without a heartbeat for this long the display counts as gone. */
  heartbeatTimeoutMs?: number;
}

/**
 * Work out the status to show from the raw signals.
 *
 * Pure so it can be unit-tested: a window handle means "connecting" until the
 * display starts heartbeating; without a handle a still-heartbeating display
 * (opened before this cashier window reloaded) still counts as connected;
 * `blocked` sticks until the operator tries again or turns dual-screen off;
 * disabled with no window is simply "off".
 */
export function deriveCustomerDisplayConnection(input: DeriveConnectionInput): CustomerDisplayConnection {
  const {enabled, hasWindow, current, lastAliveAt, now} = input;
  const timeout = input.heartbeatTimeoutMs ?? 7000;
  const heartbeating = lastAliveAt > 0 && now - lastAliveAt < timeout;

  if (!enabled && !hasWindow) return 'off';
  if (hasWindow) return heartbeating ? 'connected' : 'connecting';
  if (current === 'blocked') return 'blocked';
  return heartbeating ? 'connected' : 'not-open';
}
