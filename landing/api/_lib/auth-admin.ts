/**
 * Server-side lookup of a commerce user's Auth record.
 *
 * WHY THIS EXISTS
 * ---------------
 * STATUS: retained as reusable server-side plumbing. The `POST /api/download`
 * endpoint that first needed it has been removed — SamTill ships as a
 * browser-installed PWA, not an installer download. It originally existed so
 * that a `verified_account`-style gate could grant the installer
 * only to customers whose email address has actually been confirmed. A
 * locally-verified access token proves WHO the caller is — it does not, by
 * itself, prove the address was confirmed (a project with "Confirm email"
 * disabled issues tokens for unconfirmed users, and the token carries no
 * reliable confirmation claim across GoTrue versions).
 *
 * So the check is done authoritatively, server-side, against the Auth Admin
 * API using the service-role key. The key never leaves this process, the
 * browser is never given a chance to influence the answer, and a backend
 * failure is surfaced as an error the caller must treat as "not confirmed"
 * (fail closed) rather than as access.
 *
 * SECURITY
 *  - Service-role key: read from the validated CommerceConfig only; never
 *    logged, never returned, never sent to the browser.
 *  - The user id is interpolated into a URL path segment, so it is validated
 *    as a strict UUID first (no path traversal, no injection).
 *  - Only the configured commerce project URL is contacted.
 */

import type {CommerceConfig} from './env.ts';
import {BackendError} from './supabase.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthUserRecord {
  /** ISO timestamp of when the address was confirmed; null when it is not. */
  emailConfirmedAt: string | null;
  email?: string;
}

/**
 * Fetch one user from the commerce project's Auth Admin API.
 *
 * Throws BackendError when the user cannot be read — callers in a
 * security-decision path MUST treat a throw as "not confirmed".
 */
export async function fetchAuthUser(cfg: CommerceConfig, userId: string): Promise<AuthUserRecord> {
  if (!UUID_RE.test(userId)) {
    throw new BackendError(`unsafe user id: ${userId.slice(0, 64)}`, 500);
  }

  const url = `${cfg.supabaseUrl}/auth/v1/admin/users/${userId}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: cfg.supabaseServiceRoleKey,
        authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
      },
    });
  } catch (cause) {
    // Network-level failure. The message carries no key material.
    throw new BackendError(`commerce auth backend unreachable: ${String(cause)}`, 503);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    // GoTrue error bodies carry a message/code only — safe for server logs,
    // still never headers or keys.
    const detail = typeof data === 'object' && data !== null ? JSON.stringify(data).slice(0, 300) : '';
    throw new BackendError(
      `commerce auth admin lookup failed (${response.status})${detail ? `: ${detail}` : ''}`,
      response.status,
    );
  }

  const record = data as {email_confirmed_at?: unknown; email?: unknown} | null;
  const confirmedRaw = record?.email_confirmed_at;
  const emailRaw = record?.email;

  const result: AuthUserRecord = {
    // Anything other than a non-empty string counts as unconfirmed (fail closed).
    emailConfirmedAt: typeof confirmedRaw === 'string' && confirmedRaw !== '' ? confirmedRaw : null,
  };
  if (typeof emailRaw === 'string' && emailRaw !== '') result.email = emailRaw;
  return result;
}

/**
 * True only when the address is confirmed. A lookup failure is logged and
 * reported as `null` so the caller can distinguish "confirmed === false"
 * (deny, audit) from "could not check" (deny, surface a backend error).
 */
export async function isEmailConfirmed(cfg: CommerceConfig, userId: string): Promise<boolean | null> {
  try {
    const user = await fetchAuthUser(cfg, userId);
    return user.emailConfirmedAt !== null;
  } catch (cause) {
    console.error(`commerce: auth lookup failed for download gate: ${String(cause)}`);
    return null;
  }
}
