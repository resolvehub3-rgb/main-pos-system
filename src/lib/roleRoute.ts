/**
 * Which URL belongs to which signed-in role, scoped strictly inside `/app/`.
 *
 * Route separation:
 *  • Public marketing website lives at `/`, `/features`, `/pricing`, `/about`,
 *    `/contact`, `/download` (plus customer checkout/account hash/path routes).
 *  • The actual POS Application (PWA) operates inside the `/app/` namespace:
 *      - `/app/`             (authenticated redirect -> dashboard / login)
 *      - `/app/login`        (POS sign-in)
 *      - `/app/register`     (POS store workspace registration)
 *      - `/app/dashboard`    (POS overview dashboard)
 *      - `/app/pos`          (Sales terminal)
 *      - `/app/products`     (Product management)
 *      - `/app/inventory`    (Inventory & Stock Book management)
 *      - `/app/reports`      (Reports & analytics)
 *      - `/app/settings`     (Application & store settings)
 *      - `/app/admin`        (Super Admin dashboard)
 *      - `/app/shop-owner`   (Shop Owner workspace)
 *      - `/app/cashier`      (Cashier terminal)
 *
 * Legacy POS URLs (`/login`, `/register`, `/admin`, `/shop-owner`, `/cashier`,
 * `/dashboard`, `/pos`) are mapped to their `/app/*` equivalents so bookmarks
 * and older links keep working without leaving `/app/`.
 */

/** Base namespace for the POS PWA. */
export const APP_NAMESPACE = '/app';

/** Default POS entry path for unauthenticated visitors. */
export const APP_LOGIN_PATH = '/app/login';
export const APP_REGISTER_PATH = '/app/register';
export const APP_DASHBOARD_PATH = '/app/dashboard';
export const APP_POS_PATH = '/app/pos';
export const APP_PRODUCTS_PATH = '/app/products';
export const APP_INVENTORY_PATH = '/app/inventory';
export const APP_REPORTS_PATH = '/app/reports';
export const APP_SETTINGS_PATH = '/app/settings';

/** Generic authenticated workspace fallback for unknown roles. */
export const APP_PATH = '/app/dashboard';

export type ShopOwnerSection =
  | 'overview'
  | 'sales'
  | 'inventory'
  | 'products'
  | 'stockbook'
  | 'categories'
  | 'customers'
  | 'staff'
  | 'expenses'
  | 'reports'
  | 'settings';

const LEGACY_REDIRECTS: Record<string, string> = {
  '/login': '/app/login',
  '/register': '/app/register',
  '/admin': '/app/admin',
  '/shop-owner': '/app/shop-owner',
  '/cashier': '/app/cashier',
  '/dashboard': '/app/dashboard',
  '/pos': '/app/pos',
  '/products': '/app/products',
  '/inventory': '/app/inventory',
  '/reports': '/app/reports',
  '/settings': '/app/settings',
};

/** Every path that renders the POS app rather than the marketing website. */
export const WORKSPACE_PATHS: string[] = [
  APP_NAMESPACE,
  '/app/',
  '/app/dashboard',
  '/app/pos',
  '/app/products',
  '/app/inventory',
  '/app/reports',
  '/app/settings',
  '/app/admin',
  '/app/shop-owner',
  '/app/cashier',
];

const SHOP_OWNER_PATHS = new Set<string>([
  '/app/shop-owner',
  '/app/dashboard',
  '/app/pos',
  '/app/products',
  '/app/inventory',
  '/app/reports',
  '/app/settings',
]);

const CASHIER_PATHS = new Set<string>(['/app/cashier', '/app/pos']);

const ROLE_PATHS: Record<string, string> = {
  super_admin: '/app/admin',
  shop_owner: '/app/shop-owner',
  cashier: '/app/cashier',
};

export function normalizePosPathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  if (pathname === '/app/') return '/app/';
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/** Return the canonical `/app/*` path for a legacy POS URL, or null if not legacy. */
export function legacyPosRedirect(pathname: string): string | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return LEGACY_REDIRECTS[normalized] ?? null;
}

/** True when `pathname` belongs to the POS application (either `/app*` or a legacy POS path). */
export function isPosAppPath(pathname: string): boolean {
  const normalized = normalizePosPathname(pathname);
  if (normalized === APP_NAMESPACE || normalized.startsWith(`${APP_NAMESPACE}/`)) return true;
  return legacyPosRedirect(normalized) !== null;
}

/** The workspace path for a role; unknown roles land on `/app/dashboard`. */
export function rolePathFor(role: string): string {
  return ROLE_PATHS[role] ?? APP_PATH;
}

/** True on POS auth entry routes (`/app/login`, `/app/register`, or legacy `/login`, `/register`). */
export function isAuthEntryPath(pathname: string): boolean {
  const normalized = normalizePosPathname(pathname);
  return (
    normalized === APP_LOGIN_PATH ||
    normalized === APP_REGISTER_PATH ||
    normalized === '/login' ||
    normalized === '/register'
  );
}

/** Map a shop owner's section + till-mode toggle to the matching `/app/*` path. */
export function shopOwnerPathForSection(
  section: ShopOwnerSection,
  viewingPOS: boolean,
): string {
  if (viewingPOS) return APP_POS_PATH;
  switch (section) {
    case 'overview':
      return '/app/shop-owner';
    case 'products':
      return APP_PRODUCTS_PATH;
    case 'inventory':
    case 'stockbook':
      return APP_INVENTORY_PATH;
    case 'reports':
      return APP_REPORTS_PATH;
    case 'settings':
      return APP_SETTINGS_PATH;
    default:
      return APP_DASHBOARD_PATH;
  }
}

/** Derive initial shop owner section & POS till state from the arrival `/app/*` pathname. */
export function sectionForShopOwnerPath(pathname: string): {
  section: ShopOwnerSection;
  viewingPOS: boolean;
} {
  const normalized = normalizePosPathname(pathname);
  switch (normalized) {
    case APP_POS_PATH:
      return { section: 'overview', viewingPOS: true };
    case APP_PRODUCTS_PATH:
      return { section: 'products', viewingPOS: false };
    case APP_INVENTORY_PATH:
      return { section: 'inventory', viewingPOS: false };
    case APP_REPORTS_PATH:
      return { section: 'reports', viewingPOS: false };
    case APP_SETTINGS_PATH:
      return { section: 'settings', viewingPOS: false };
    default:
      return { section: 'overview', viewingPOS: false };
  }
}

/**
 * The pathname this URL should show for `user`, given the one it has now.
 *
 * Pure so it can be reasoned about without a browser: `syncAuthUrl` only
 * applies the answer.
 */
export function authPathFor(user: { role: string } | null, currentPath: string): string {
  const legacy = legacyPosRedirect(currentPath);
  const effectivePath = legacy ?? normalizePosPathname(currentPath);

  if (user) {
    if (user.role === 'shop_owner' && SHOP_OWNER_PATHS.has(effectivePath)) {
      return effectivePath;
    }
    if (user.role === 'cashier' && CASHIER_PATHS.has(effectivePath)) {
      return effectivePath;
    }
    return rolePathFor(user.role);
  }

  // No session: keep `/app/register` if asked for explicitly; every other
  // POS path resolves to `/app/login` so an unauthenticated visitor never sees
  // a workspace path in the address bar.
  if (effectivePath === APP_REGISTER_PATH) return APP_REGISTER_PATH;
  if (isPosAppPath(effectivePath)) return APP_LOGIN_PATH;
  return currentPath;
}

/**
 * Rewrite the address bar to match the session without leaving `/app/`.
 */
export function syncAuthUrl(user: { role: string } | null): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const next = authPathFor(user, window.location.pathname);
  if (next === window.location.pathname) return;
  window.history.replaceState({}, '', next + window.location.search + window.location.hash);
}
