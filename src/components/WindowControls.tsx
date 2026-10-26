import React, { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import {
  isDesktop,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isMaximizedWindow,
  onWindowMaximizedChanged,
} from '../lib/desktopBridge';

/**
 * Custom minimize / maximize-restore / close controls for the frameless
 * desktop window.
 *
 * Rendered only inside the Electron app (`isDesktop()`); on the web/PWA it
 * returns null so the browser keeps its own window chrome. Every button calls
 * the narrow, main-process-gated desktop bridge — no Electron or Node API is
 * ever exposed to the renderer, and the handlers only respond to the cashier
 * window's own main frame.
 */
export const WindowControls: React.FC = () => {
  const [available, setAvailable] = useState<boolean>(() => isDesktop());
  const [maximized, setMaximized] = useState<boolean>(false);

  useEffect(() => {
    if (!isDesktop()) return;
    setAvailable(true);
    // Prime the icon from the real window state, then follow live changes
    // (e.g. the window being snapped/restored with the keyboard).
    void isMaximizedWindow().then((m) => {
      if (typeof m === 'boolean') setMaximized(m);
    });
    return onWindowMaximizedChanged(setMaximized);
  }, []);

  if (!available) return null;

  const base =
    'flex items-center justify-center w-12 h-8 text-slate-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/60';

  return (
    <div
      data-testid="window-controls"
      role="group"
      aria-label="Window controls"
      className="flex items-stretch samtill-no-drag"
    >
      <button
        type="button"
        onClick={minimizeWindow}
        aria-label="Minimize window"
        title="Minimize"
        className={`${base} hover:bg-white/10`}
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={toggleMaximizeWindow}
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
        className={`${base} hover:bg-white/10`}
      >
        {maximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
      </button>
      <button
        type="button"
        onClick={closeWindow}
        aria-label="Close window"
        title="Close"
        className={`${base} hover:bg-rose-600 hover:text-white`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
