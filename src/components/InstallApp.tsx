import React, {useEffect, useState} from 'react';
import {Download, HelpCircle, MonitorDown, X} from 'lucide-react';
import {canPromptInstall, isStandalone, onInstallAvailable, promptInstall} from '../lib/pwa';

/**
 * "Install SamTill" entry point.
 *
 * Honest behaviour (no fake buttons):
 *  - Chromium browsers (Chrome, Edge) fire `beforeinstallprompt` when the
 *    app is genuinely installable → the button shows and triggers the
 *    REAL browser install dialog.
 *  - Browsers without an install prompt (iOS Safari, Firefox, older
 *    versions) → the button opens a help screen with the accurate manual
 *    steps for that platform (Add to Home Screen / Install this site).
 *  - Already running installed (standalone) → renders nothing.
 */
export const InstallApp: React.FC = () => {
  const [installed] = useState<boolean>(() => isStandalone());
  const [installable, setInstallable] = useState<boolean>(() => canPromptInstall());
  const [showHelp, setShowHelp] = useState<boolean>(false);

  useEffect(() => {
    return onInstallAvailable(() => setInstallAvailable());
  }, []);

  const setInstallAvailable = () => setInstallable(canPromptInstall());

  if (installed) return null;

  const handleInstall = async () => {
    if (!installable) {
      setShowHelp(true);
      return;
    }
    const result = await promptInstall();
    if (result === 'unavailable') {
      // The prompt expired or was consumed — fall back to the help screen.
      setInstallable(false);
      setShowHelp(true);
    }
  };

  // One-line platform hint for the help screen.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);

  return (
    <>
      <button
        onClick={handleInstall}
        title={installable ? 'Install SamTill on this device' : 'How to install SamTill'}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#F28C28]/15 text-[#F28C28] border border-[#F28C28]/40 hover:bg-[#F28C28]/25 transition cursor-pointer"
      >
        {installable ? <Download className="w-3.5 h-3.5" /> : <HelpCircle className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">Install app</span>
      </button>

      {showHelp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install SamTill"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white text-slate-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#102A4C] text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <MonitorDown className="w-5 h-5 text-[#F28C28]" />
                <h2 className="text-lg font-black">Install SamTill</h2>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg hover:bg-slate-700/60 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm leading-relaxed">
              {isIOS ? (
                <>
                  <p className="font-semibold">On iPhone / iPad (Safari):</p>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Open this page in <strong>Safari</strong>.</li>
                    <li>Tap the <strong>Share</strong> button (square with an arrow).</li>
                    <li>Choose <strong>Add to Home Screen</strong>.</li>
                    <li>Tap <strong>Add</strong> — SamTill appears on your home screen.</li>
                  </ol>
                </>
              ) : isAndroid ? (
                <>
                  <p className="font-semibold">On Android:</p>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>Open this page in <strong>Chrome</strong>.</li>
                    <li>Tap the <strong>⋮</strong> menu (top right).</li>
                    <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                    <li>Confirm with <strong>Install</strong>.</li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="font-semibold">On Windows / Mac (Chrome or Edge):</p>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>
                      Look for the <strong>install icon</strong> at the right end of the address
                      bar, or open the browser menu (<strong>⋮</strong> / <strong>⋯</strong>).
                    </li>
                    <li>
                      Choose <strong>Install SamTill</strong> / <strong>Install this site as an
                      app</strong>.
                    </li>
                    <li>Confirm — SamTill opens in its own window and gets a taskbar icon.</li>
                  </ol>
                  <p className="text-xs text-slate-500">
                    If the option is missing, make sure you are signed in and using a supported
                    browser (Chrome 89+ or Edge 89+).
                  </p>
                </>
              )}

              <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
                The installed app opens SamTill in its own window — no browser tabs — and works
                exactly like this page. Signing in is still required every session.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
