import React from 'react';
import {AlertTriangle, Info} from 'lucide-react';

export interface KioskNoticeAction {
  label: string;
  onClick: () => void;
  /** Styling emphasis — one primary action per notice. */
  primary?: boolean;
}

interface KioskNoticeProps {
  /** `warning` (browser refused something) / `info` (optional improvement). */
  tone?: 'warning' | 'info';
  /** One-line explanation of what happened and what will fix it. */
  message: React.ReactNode;
  /** Buttons: the first is usually the one-click activation path. */
  actions: KioskNoticeAction[];
  /** Optional "Not now" — hides the notice for this session only. */
  onDismiss?: () => void;
}

/**
 * Slim activation notice shown under the header.
 *
 * Browsers require a user gesture for full-screen and (the first time) for
 * opening a second window — SamTill never pretends otherwise. When an
 * automatic attempt is refused, this bar explains it in one line and offers
 * the click that completes the action. It never blocks the till: dismissing
 * it, or ignoring it entirely, leaves checkout working exactly as before.
 */
export const KioskNotice: React.FC<KioskNoticeProps> = ({
  tone = 'warning',
  message,
  actions,
  onDismiss,
}) => {
  const isWarning = tone === 'warning';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-16 z-30 flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b text-xs font-semibold ${
        isWarning
          ? 'bg-amber-50 text-amber-900 border-amber-300'
          : 'bg-slate-100 text-slate-700 border-slate-200'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isWarning ? (
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-600" />
        ) : (
          <Info className="w-4 h-4 flex-shrink-0 text-slate-500" />
        )}
        <span className="min-w-0">{message}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              action.primary
                ? 'bg-[#F28C28] hover:bg-orange-600 text-white shadow-sm'
                : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
            }`}
          >
            {action.label}
          </button>
        ))}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="px-2 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-white/70 transition"
          >
            Not now
          </button>
        )}
      </div>
    </div>
  );
};
