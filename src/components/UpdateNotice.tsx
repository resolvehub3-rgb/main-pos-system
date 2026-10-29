import React, {useEffect, useState} from 'react';
import {RefreshCw, X} from 'lucide-react';
import {applyUpdate, onUpdateReady} from '../lib/pwa';

/**
 * PWA update notification (replaces the old desktop installer toast).
 *
 * Shown when a new service-worker version has been downloaded and is
 * waiting. It NEVER applies itself: the operator presses "Update now" (which
 * reloads once) or dismisses it and keeps working — an in-progress checkout
 * is never destroyed by a silent background reload.
 */
export const UpdateNotice: React.FC = () => {
  const [updateReady, setUpdateReady] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    return onUpdateReady(() => {
      // A dismissed notice re-appears only on a fresh update event, not on
      // every page load — pressing Update later is still possible because
      // the waiting worker stays waiting.
      setDismissed(false);
      setUpdateReady(true);
    });
  }, []);

  if (!updateReady || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-16 z-40 bg-[#102A4C] text-white border-b border-orange-500/40 shadow-md"
    >
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm">
        <span className="font-semibold">
          A new version of SamTill is ready. It applies only when you choose — your current sale
          will not be interrupted.
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={applyUpdate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F28C28] hover:bg-orange-600 text-white rounded-lg transition font-bold cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Update now</span>
          </button>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss update notice"
            className="p-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-600 text-slate-200 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
