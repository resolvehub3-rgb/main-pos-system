/**
 * Session state for the account screens.
 *
 * - Restores an existing session after a page refresh.
 * - Validates that session against the auth server with getUser() rather than
 *   trusting the copy persisted in localStorage: a token that was revoked,
 *   deleted or otherwise invalidated server-side resolves to "signed out" here
 *   even while localStorage still holds it. getSession() alone would happily
 *   hand back a stale cached session.
 * - Subscribes to auth state changes so sign-in, sign-out, verification and
 *   password recovery propagate to every mounted screen.
 * - When the commerce project is not configured, `session` stays null and
 *   `loading` resolves to false, so guarded screens can render their
 *   "not available" notice instead of hanging.
 *
 * NOTE: this is a UX guard, not a security boundary. The only real boundary is
 * the server-side session check inside POST /api/download.
 */

import {useCallback, useEffect, useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {getCommerceAuth} from './commerceClient';

export interface AccountIdentity {
  accessToken: string;
  userId: string;
  email?: string;
}

export interface AccountSessionState {
  session: Session | null;
  loading: boolean;
  /** Null until a customer is actually signed in. */
  account: AccountIdentity | null;
  signOut: () => Promise<void>;
}

export function useAccountSession(): AccountSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getCommerceAuth();
    if (!client) {
      setSession(null);
      setLoading(false);
      return;
    }

    let active = true;
    client.auth
      .getSession()
      .then(async ({data}) => {
        const persisted = data.session ?? null;
        if (!persisted) {
          if (active) setSession(null);
          return;
        }

        // Trust but verify: getUser() round-trips to the auth server, so a
        // session that was revoked, deleted or otherwise invalidated
        // server-side resolves to signed-out here instead of being served
        // from the stale localStorage copy.
        const {data: userData, error} = await client.auth.getUser();
        if (!active) return;
        if (error || !userData?.user) {
          setSession(null);
          return;
        }
        // Keep the local session object (it carries the access token) but
        // replace the user with the server-confirmed one.
        setSession({...persisted, user: userData.user});
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const subscription = client.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    const client = getCommerceAuth();
    if (!client) return;
    try {
      await client.auth.signOut();
    } finally {
      setSession(null);
    }
  }, []);

  const account: AccountIdentity | null =
    session && session.access_token && session.user
      ? {
          accessToken: session.access_token,
          userId: session.user.id,
          ...(session.user.email ? {email: session.user.email} : {}),
        }
      : null;

  return {session, loading, account, signOut};
}
