/**
 * POS routing & session-to-URL resolution under the `/app/` namespace.
 *
 * Separation architecture:
 *  • Public marketing website lives at `/`, `/features`, `/pricing`,
 *    `/about`, `/contact`, and `/download`.
 *  • The actual SamTill POS application lives strictly inside `/app/`:
 *      - `/app/login`     → POS login screen
 *      - `/app/register`  → POS store registration screen
 *      - `/app/dashboard` → Shop Owner dashboard overview
 *      - `/app/pos`       → Sales terminal (Cashier workstation & Owner till mode)
 *      - `/app/products`  → Product management
 *      - `/app/inventory` → Inventory management
 *      - `/app/reports`   → Reports & analytics
 *      - `/app/settings`  → Application settings
 *      - `/app/sales`, `/app/stockbook`, `/app/categories`, `/app/customers`,
 *        `/app/staff`, `/app/expenses` → Owner sub-views
 *      - `/app/admin`     → Super Admin workspace
 *
 * Legacy root-level POS URLs (`/login`, `/register`, `/admin`, `/shop-owner`,
 * `/cashier`) are still recognized as POS entry points and immediately
 * normalized into `/app/*` so existing bookmarks continue to work without
 * ever leaving the POS outside `/app/`.
 */

export const POS_NAMESPACE = '/app';
export const POS_LOGIN_PATH = '/app/login';
export const POS_REGISTER_PATH = '/app/register';
export const POS_DASHBOARD_PATH = '/app/dashboard';
export const POS_TERMINAL_PATH = '/app/pos';
export const POS_ADMIN_PATH = '/app/admin';
export const POS_PRODUCTS_PATH = '/app/products';
export const POS_INVENTORY_PATH = '/app/inventory';
export const POS_REPORTS_PATH = '/app/reports';
export const POS_SETTINGS_PATH = '/app/settings';

export type ShopOwnerMenu =
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

const OWNER_MENU_PATHS: Record<ShopOwnerMenu, string> = {
  overview: POS_DASHBOARD_PATH,
  sales: '/app/sales',
  inventory: POS_INVENTORY_PATH,
  products: POS_PRODUCTS_PATH,
  stockbook: '/app/stockbook',
  categories: '/app/categories',
  customers: '/app/customers',
  staff: '/app/staff',
  expenses: '/app/expenses',
  reports: POS_REPORTS_PATH,
  settings: POS_SETTINGS_PATH,
};

const PATH_TO_OWNER_MENU: Record<string, ShopOwnerMenu> = {
  [POS_DASHBOARD_PATH]: 'overview',
  '/app/sales': 'sales',
  [POS_INVENTORY_PATH]: 'inventory',
  [POS_PRODUCTS_PATH]: 'products',
  '/app/stockbook': 'stockbook',
  '/app/categories': 'categories',
  '/app/customers': 'customers',
  '/app/staff': 'staff',
  '/app/expenses': 'expenses',
  [POS_REPORTS_PATH]: 'reports',
  [POS_SETTINGS_PATH]: 'settings',
};

const LEGACY_POS_PATHS = new Set([
  '/login',
  '/register',
  '/admin',
  '/shop-owner',
  '/cashier',
]);

const ROLE_PATHS: Record<string, string> = {
  super_admin: POS_ADMIN_PATH,
  shop_owner: POS_DASHBOARD_PATH,
  cashier: POS_TERMINAL_PATH,
};

/** Normalize trailing slashes (except root '/') for reliable route matching. */
export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

/** True for any route owned by the POS application (inside `/app/` or legacy POS aliases). */
export function isPosPath(pathname: string): boolean {
  const norm = normalizePathname(pathname);
  return norm === POS_NAMESPACE || norm.startsWith(`${POS_NAMESPACE}/`) || LEGACY_POS_PATHS.has(norm);
}

/** True for auth entry points (`/app/login`, `/app/register`, and legacy `/login`, `/register`). */
export function isAuthEntryPath(pathname: string): boolean {
  const norm = normalizePathname(pathname);
  return (
    norm === POS_LOGIN_PATH ||
    norm === POS_REGISTER_PATH ||
    norm === '/login' ||
    norm === '/register'
  );
}

/** Default workspace path for a signed-in user's role. */
export function rolePathFor(role: string): string {
  return ROLE_PATHS[role] ?? POS_DASHBOARD_PATH;
}

/** Map a ShopOwnerDashboard menu key to its `/app/*` pathname. */
export function pathFromShopOwnerMenu(menu: ShopOwnerMenu): string {
  return OWNER_MENU_PATHS[menu] ?? POS_DASHBOARD_PATH;
}

/** Map a `/app/*` pathname to the corresponding ShopOwnerDashboard menu key (defaults to `'overview'`). */
export function shopOwnerMenuFromPath(pathname: string): ShopOwnerMenu {
  const norm = normalizePathname(pathname);
  return PATH_TO_OWNER_MENU[norm] ?? 'overview';
}

/** True when `pathname` is the POS sales terminal (`/app/pos` or legacy `/cashier`). */
export function isTerminalPath(pathname: string): boolean {
  const norm = normalizePathname(pathname);
  return norm === POS_TERMINAL_PATH || norm === '/cashier';
}

/**
 * Check whether an authenticated user with `role` is allowed to stay on `pathname`.
 * Sub-routes like `/app/products` or `/app/pos` are preserved on page refresh for
 * authorized roles instead of snapping back to `/app/dashboard`.
 */
function isAllowedAuthenticatedPath(role: string, normPath: string): boolean {
  if (role === 'super_admin') {
    return normPath === POS_ADMIN_PATH;
  }
  if (role === 'cashier') {
    return normPath === POS_TERMINAL_PATH;
  }
  if (role === 'shop_owner') {
    return normPath === POS_TERMINAL_PATH || normPath in PATH_TO_OWNER_MENU;
  }
  return normPath === POS_DASHBOARD_PATH;
}

/**
 * The pathname the URL should resolve to for `user`, given `currentPath`.
 *
 * Pure so every transition can be unit-tested without a browser:
 *  - Unauthenticated: `/app/register` (or `/register`) → `/app/register`;
 *    every other POS path → `/app/login` (NEVER `/`!).
 *  - Authenticated: auth entry points, `/app`, and legacy aliases resolve to
 *    `rolePathFor(user.role)`; valid role-allowed `/app/*` sub-routes are
 *    preserved across page reloads.
 */
export function authPathFor(user: { role: string } | null, currentPath: string): string {
  const norm = normalizePathname(currentPath);

  if (!user) {
    if (norm === POS_REGISTER_PATH || norm === '/register') {
      return POS_REGISTER_PATH;
    }
    return isPosPath(norm) ? POS_LOGIN_PATH : norm;
  }

  // Legacy path normalization when authenticated
  if (norm === '/admin') return user.role === 'super_admin' ? POS_ADMIN_PATH : rolePathFor(user.role);
  if (norm === '/cashier') return user.role === 'super_admin' ? POS_ADMIN_PATH : POS_TERMINAL_PATH;
  if (norm === '/shop-owner') return user.role === 'shop_owner' ? POS_DASHBOARD_PATH : rolePathFor(user.role);

  if (isAllowedAuthenticatedPath(user.role, norm)) {
    return norm;
  }

  return rolePathFor(user.role);
}

/**
 * Rewrite the address bar with `replaceState` to match the session.
 */
export function syncAuthUrl(user: { role: string } | null): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const next = authPathFor(user, window.location.pathname);
  if (next === window.location.pathname) return;
  window.history.replaceState({}, '', next + window.location.search + window.location.hash);
}

/**
 * Push a POS route transition onto browser history (e.g. clicking sidebar
 * tabs or entering/exiting the sales terminal) so browser Back/Forward works.
 */
export function pushPosPath(targetPath: string): void {
  if (typeof window === 'undefined' || !window.history?.pushState) return;
  const norm = normalizePathname(targetPath);
  if (normalizePathname(window.location.pathname) === norm) return;
  window.history.pushState({}, '', norm);
}
