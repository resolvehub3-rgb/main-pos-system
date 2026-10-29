import React, {useEffect, useState} from 'react';
import {WifiOff} from 'lucide-react';

/**
 * Offline banner.
 *
 * The app is local-first: the till keeps working from the localStorage
 * mirror and re-syncs to Supabase on the next successful start/connection
 * (idempotent upserts — see src/lib/sync.ts). The banner tells the operator
 * exactly that, so nobody assumes the device is online when settling mobile-money
 * payments or signing in a new account (both need the network).
 */
export const OfflineBanner: React.FC = () => {
  const [offline, setOffline] = useState<boolean>(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-500/95 text-amber-950 border-b border-amber-600/50"
    >
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 py-2 flex items-center gap-2 text-xs sm:text-sm font-semibold">
        <WifiOff className="w-4 h-4 flex-shrink-0" />
        <span>
          You are offline. Selling continues from this device&apos;s local data and syncs
          automatically when the connection returns. Online sign-in and mobile-money payments
          need a connection.
        </span>
      </div>
    </div>
  );
};
