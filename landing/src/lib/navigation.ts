/**
 * Browser navigation helpers for marketing pages and hash-routed account screens.
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

/**
 * Navigate cleanly across marketing paths (`/`, `/features`, `/pricing`,
 * `/about`, `/contact`, `/download`) via History API without reloading, or
 * hash routes (`#/checkout`), or full-page transitions into `/app/*`.
 */
export function navigateRoute(href: string): void {
  if (href.startsWith('/app')) {
    window.location.assign(href);
    return;
  }
  if (href.startsWith('#')) {
    const targetHash = href.startsWith('#/') ? href : href;
    if (window.location.pathname !== '/' && href.startsWith('#/')) {
      window.history.pushState({}, '', `/${targetHash}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    window.location.hash = targetHash;
    return;
  }
  const normalized = href.startsWith('/') ? href : `/${href}`;
  if (window.location.pathname !== normalized || window.location.hash) {
    window.history.pushState({}, '', normalized);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

export function loginHref(next?: AccountRoute): string {
  return next ? `#/login?next=${next.replace('/', '')}` : '#/login';
}

export function registerHref(next?: AccountRoute): string {
  return next ? `#/register?next=${next.replace('/', '')}` : '#/register';
}
