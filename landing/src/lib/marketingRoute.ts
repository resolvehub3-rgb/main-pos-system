/**
 * Pure pathname routing helpers for the public SamTill marketing website.
 *
 * The marketing website serves dedicated pages at:
 *   /           → Homepage
 *   /features   → Product features & screenshots
 *   /pricing    → Packages & comparison
 *   /about      → About SamTill & onboarding
 *   /contact    → Enquiry & business contact details
 *   /download   → Smart PWA installation & platform instructions
 *
 * POS application routes (`/app/*`) are handled separately by `src/main.tsx`
 * and never enter the marketing layout.
 */

export const MARKETING_ROUTES = [
  '/',
  '/features',
  '/pricing',
  '/about',
  '/contact',
  '/download',
] as const;

export type MarketingRoute = (typeof MARKETING_ROUTES)[number];

export function normalizeMarketingPath(pathname: string): MarketingRoute {
  const clean = (pathname || '/').trim().toLowerCase().replace(/\/+$/, '') || '/';
  if ((MARKETING_ROUTES as readonly string[]).includes(clean)) {
    return clean as MarketingRoute;
  }
  return '/';
}

export function isMarketingRoutePath(pathname: string): boolean {
  const clean = (pathname || '/').trim().toLowerCase().replace(/\/+$/, '') || '/';
  return (MARKETING_ROUTES as readonly string[]).includes(clean);
}

export function marketingPageTitle(route: MarketingRoute): string {
  switch (route) {
    case '/features':
      return 'Features — SamTill POS | SamTeck Digital';
    case '/pricing':
      return 'Pricing — SamTill POS | SamTeck Digital';
    case '/about':
      return 'About SamTill — SamTeck Digital';
    case '/contact':
      return 'Contact — SamTill POS | SamTeck Digital';
    case '/download':
      return 'Install SamTill POS — App & Browser Guide';
    case '/':
    default:
      return 'SamTill — Supermarket & Retail POS for Ghana | SamTeck Digital';
  }
}

export function navigateMarketing(target: string): void {
  if (typeof window === 'undefined') return;
  if (target.startsWith('/app')) {
    window.location.assign(target);
    return;
  }
  if (target.startsWith('#')) {
    const id = target.slice(1);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({behavior: 'smooth'});
      return;
    }
    // If the anchor section is not mounted on the current subpage, go home.
    window.history.pushState({}, '', `/${target}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }
  const normalized = normalizeMarketingPath(target);
  if (window.location.pathname !== normalized || window.location.hash) {
    window.history.pushState({}, '', normalized);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  window.scrollTo({top: 0, behavior: 'smooth'});
}
