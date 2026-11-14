/**
 * Which URL belongs to which signed-in role.
 *
 * The POS renders from `window.location.pathname` (`src/main.tsx`): `/login`
 * and `/register` are the auth entry points, and the workspace paths below
 * open the app. Until now a signed-in operator kept whatever URL they arrived
 * on — logging in from the register tab left `…/register` in the address bar
 * for the whole session, showing a page their role can no longer use.
 *
 * The address bar therefore tracks the session:
 *
 *  • signed in            → that role's own path (`/admin`, `/shop-owner`,
 *                           `/cashier`); an unrecognised legacy role falls
 *                           back to the generic `/app` workspace.
 *  • signed out           → `/login`, except when the URL is already an auth
 *                           entry point: `/register` must keep working as a
 *                           deep link for people who have not signed up yet.
 *                           Workspace paths resolve to `/login` so a logged-
 *                           out visit to `/admin` cannot claim to be one.
 *
 * History is rewritten with `replaceState`, never pushed: a login is not a
 * "back" destination, and replacing is what makes the `/register` entry
 * itself disappear from the back button once the session exists.
 */

/** Generic authenticated workspace, used for a role this build does not know. */
export const APP_PATH = '/app';

/** Every path that renders the POS app rather than the landing site. */
export const WORKSPACE_PATHS: string[] = [
  APP_PATH,
  '/admin',
  '/shop-owner',
  '/cashier',
];

const ROLE_PATHS: Record<string, string> = {
  super_admin: '/admin',
  shop_owner: '/shop-owner',
  cashier: '/cashier',
};

/** The workspace path for a role; unknown roles land on the generic app. */
export function rolePathFor(role: string): string {
  return ROLE_PATHS[role] ?? APP_PATH;
}

/** The auth entry point for a role; unknown roles land on the generic app. */
export function isAuthEntryPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/register';
}

/**
 * The pathname this URL should show for `user`, given the one it has now.
 *
 * Pure so it can be reasoned about without a browser: `syncAuthUrl` only
 * applies the answer.
 */
export function authPathFor(user: { role: string } | null, currentPath: string): string {
  if (user) return rolePathFor(user.role);
  // No session: keep whichever auth page was asked for, but never let a
  // workspace path stand in for a login screen that is not there yet.
  if (isAuthEntryPath(currentPath)) return currentPath;
  return WORKSPACE_PATHS.includes(currentPath) ? '/login' : currentPath;
}

/**
 * Rewrite the address bar to match the session.
 *
 * Called from `App` whenever the current user changes (sign-in, sign-out,
 * session restore, a role change pushed over realtime). Query and hash are
 * carried across so nothing else the URL carried is lost. No-ops when the URL
 * is already right, and under a non-browser runtime (the test runner) so the
 * pure helpers above stay usable everywhere.
 */
export function syncAuthUrl(user: { role: string } | null): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const next = authPathFor(user, window.location.pathname);
  if (next === window.location.pathname) return;
  window.history.replaceState({}, '', next + window.location.search + window.location.hash);
}
