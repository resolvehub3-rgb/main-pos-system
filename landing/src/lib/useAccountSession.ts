/**
 * Session state for the account screens.
 *
 * - Restores an existing session after a page refresh (getSession reads the
 *   persisted session and refreshes an expired access token when possible).
 * - Subscribes to auth state changes so sign-in, sign-out, verification and
 *   password recovery propagate to every mounted screen.
 * - When the commerce project is not configured, `session` stays null and
 *   `loading` resolves to false, so guarded screens can render their
 *   "not available" notice instead of hanging.
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
      .then(({data}) => {
        if (!active) return;
        setSession(data.session ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setLoading(false);
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
