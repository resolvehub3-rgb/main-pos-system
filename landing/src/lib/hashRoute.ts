/**
 * Hash-based routing helpers (pure).
 *
 * The marketing site is a static single-page build with no server rewrites,
 * so account screens live behind hash routes: `#/register`, `#/login`,
 * `#/verify`, `#/forgot-password`, `#/reset-password`, `#/account`,
 * `#/download`. Anything that does not start with `#/` (e.g. the section
 * anchors `#features`, `#contact`) is NOT a route and keeps its normal
 * scroll behaviour.
 *
 * Email links append their query string to the configured redirect URL, so a
 * redirect of `https://site/#/verify` arrives as
 * `https://site/#/verify?token_hash=…&type=signup` (parameters inside the
 * fragment), while a plain Site URL arrives as `/?token_hash=…&type=signup`
 * (parameters in the real query). Both shapes are handled below.
 */

export const ACCOUNT_ROUTES = [
  '/register',
  '/login',
  '/verify',
  '/forgot-password',
  '/reset-password',
  '/account',
  '/download',
] as const;

export type AccountRoute = (typeof ACCOUNT_ROUTES)[number];

export interface ParsedRoute {
  /** '/' for the marketing home page; otherwise a path like '/register'. */
  path: string;
  /** Merged parameters: real query string first, then hash query. */
  params: URLSearchParams;
}

function splitFragment(raw: string): {path: string; query: string} {
  const fragment = raw.startsWith('#') ? raw.slice(1) : raw;
  const index = fragment.indexOf('?');
  if (index === -1) return {path: fragment, query: ''};
  return {path: fragment.slice(0, index), query: fragment.slice(index + 1)};
}

/**
 * Parse the current location into a route. Section anchors such as
 * `#features` return path '/' (home) with no parameters.
 */
export function parseRoute(hash: string, search: string): ParsedRoute {
  const realQuery = search.startsWith('?') ? search.slice(1) : search;

  // A section anchor (no leading slash) is not a route — treat as home.
  if (hash !== '' && !hash.startsWith('#/')) {
    return {path: '/', params: new URLSearchParams(realQuery)};
  }

  const {path, query} = splitFragment(hash);
  const params = new URLSearchParams(realQuery);
  const fromHash = new URLSearchParams(query);
  fromHash.forEach((value, key) => {
    // The real query string wins: it is what the email provider appended to
    // the bare Site URL, and it is unambiguous.
    if (!params.has(key)) params.set(key, value);
  });

  const normalized = path === '' || path === '/' ? '/' : path.replace(/\/+$/, '');
  return {path: normalized === '' ? '/' : normalized, params};
}

export function isAccountRoute(path: string): path is AccountRoute {
  return (ACCOUNT_ROUTES as readonly string[]).includes(path);
}

export type VerificationParams =
  | {mode: 'otp'; tokenHash: string; type: string}
  | {mode: 'code'; code: string}
  | null;

/**
 * Pull email-verification / recovery parameters out of a parsed route.
 * - `token_hash` + `type`  → supabase.auth.verifyOtp(...)
 * - `code`                 → supabase.auth.exchangeCodeForSession (PKCE)
 * Returns null when neither is present, so a plain visit renders the form.
 */
export function verificationParams(params: URLSearchParams): VerificationParams {
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (tokenHash && type) {
    return {mode: 'otp', tokenHash, type};
  }
  const code = params.get('code');
  if (code) {
    return {mode: 'code', code};
  }
  return null;
}

/** Route to send the customer to after signing in (default: account page). */
export function nextRouteAfterSignIn(params: URLSearchParams): AccountRoute {
  const next = params.get('next');
  if (next === 'download') return '/download';
  if (next === 'register') return '/register';
  return '/account';
}
