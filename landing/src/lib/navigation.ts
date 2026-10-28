/**
 * Browser navigation helpers for the hash-routed account screens.
 * (Kept out of hashRoute.ts so that file stays pure and unit-testable.)
 */

import type {AccountRoute} from './hashRoute.ts';

/** Change the current hash route (e.g. navigateTo('/login')). */
export function navigateTo(path: string): void {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

export function loginHref(next?: AccountRoute): string {
  return next ? `#/login?next=${next.replace('/', '')}` : '#/login';
}
