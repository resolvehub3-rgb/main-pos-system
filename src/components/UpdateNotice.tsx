import React, {useEffect, useState} from 'react';
import {Download, RefreshCw, X} from 'lucide-react';
import {checkForUpdates, isDesktop, onUpdateStatus, openExternalUrl} from '../lib/desktopBridge';
import type {UpdateStatus} from '../types/desktop';

/**
 * Non-blocking update notification (desktop only).
 *
 * The main process checks the publisher's release manifest at startup and
 * pushes the result over IPC; this strip only ever *informs* — the cashier
 * chooses "Download update" (which opens the publisher-hosted installer page
 * in the OS browser) or "Later". Nothing downloads, installs or restarts the
 * till from here, so a transaction is never interrupted.
 *
 * Never renders in the browser/PWA (no bridge → no status).
 */
export const UpdateNotice: React.FC = () => {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isDesktop()) return;
    let alive = true;
    // The main process pushes its startup result (re-pushed after reloads);
    // this mount-time check covers the case where that push happened while
    // the operator was still on the login screen.
    void checkForUpdates().then((next) => {
      if (alive && next) setStatus(next);
    });
    const unsubscribe = onUpdateStatus((next) => {
      if (!alive) return;
      setStatus(next);
      if (next.state === 'available') setDismissed(false);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (!isDesktop() || dismissed || status?.state !== 'available') return null;

  return (
    <div className="sticky top-16 z-30 bg-[#102A4C] text-orange-200 px-4 py-2 border-b border-amber-500/40 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
      <div className="flex items-center gap-2">
        <RefreshCw className="w-4 h-4 text-amber-400" />
        <span>
          Update available: SamTill POS v{status.currentVersion} &rarr; v{status.version}
          {status.notes ? ` — ${status.notes}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => openExternalUrl(status.state === 'available' ? status.url : '')}
          className="flex items-center gap-1.5 px-3 py-1 bg-[#F28C28] hover:bg-orange-600 text-white rounded-lg transition font-bold"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download update</span>
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss update notice"
          className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition font-bold"
        >
          <X className="w-3.5 h-3.5" />
          <span>Later</span>
        </button>
      </div>
    </div>
  );
};
