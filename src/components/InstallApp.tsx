import React, {useEffect, useState} from 'react';
import {Download, HelpCircle, MonitorDown, X} from 'lucide-react';
import {
  getPwaInstallSnapshot,
  onInstallAvailable,
  promptInstall,
  type PwaInstallSnapshot,
} from '../lib/pwa';
import {detectInstallPlatform, PLATFORM_INSTALL_GUIDES} from '../lib/pwaInstall';

/**
 * In-POS "Install SamTill" header control.
 *
 * Automatically hides when running in standalone mode. Otherwise shows the
 * native Chromium install prompt when available, or opens the accurate
 * 4-platform installation instructions modal.
 */
export const InstallApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<PwaInstallSnapshot>(() => getPwaInstallSnapshot());
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [dismissedMsg, setDismissedMsg] = useState<boolean>(false);

  const detectedPlatform =
    typeof navigator !== 'undefined' ? detectInstallPlatform(navigator.userAgent) : 'chrome-windows';
  const [selectedPlatform, setSelectedPlatform] = useState(detectedPlatform);

  useEffect(() => {
    return onInstallAvailable(() => setSnapshot(getPwaInstallSnapshot()));
  }, []);

  if (snapshot.isStandalone || snapshot.state === 'installed') return null;

  const handleInstall = async () => {
    if (!snapshot.canPrompt) {
      setShowHelp(true);
      return;
    }
    const result = await promptInstall();
    setSnapshot(getPwaInstallSnapshot());
    if (result === 'dismissed') {
      setDismissedMsg(true);
    } else if (result === 'unavailable') {
      setShowHelp(true);
    }
  };

  const activeGuide =
    PLATFORM_INSTALL_GUIDES.find((g) => g.id === selectedPlatform) ?? PLATFORM_INSTALL_GUIDES[0];

  return (
    <>
      <button
        onClick={handleInstall}
        title={snapshot.canPrompt ? 'Install SamTill POS on this device' : 'How to install SamTill POS'}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#F28C28]/15 text-[#F28C28] border border-[#F28C28]/40 hover:bg-[#F28C28]/25 transition cursor-pointer"
      >
        {snapshot.canPrompt ? (
          <Download className="w-3.5 h-3.5" />
        ) : (
          <HelpCircle className="w-3.5 h-3.5" />
        )}
        <span className="hidden sm:inline">
          {snapshot.canPrompt ? 'Install SamTill' : 'Install app'}
        </span>
      </button>

      {showHelp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install SamTill POS"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white text-slate-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#102A4C] text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <MonitorDown className="w-5 h-5 text-[#F28C28]" />
                <h2 className="text-lg font-black">Install SamTill POS</h2>
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
              {dismissedMsg && (
                <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-900">
                  Installation prompt was dismissed. You can install manually anytime using the steps below.
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {PLATFORM_INSTALL_GUIDES.map((guide) => (
                  <button
                    key={guide.id}
                    type="button"
                    onClick={() => setSelectedPlatform(guide.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      guide.id === activeGuide.id
                        ? 'bg-[#102A4C] text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {guide.shortLabel}
                  </button>
                ))}
              </div>

              <div>
                <p className="font-bold text-slate-900">{activeGuide.label}:</p>
                <ol className="mt-2 list-decimal pl-5 space-y-1.5 text-slate-700">
                  {activeGuide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>

              <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
                The installed app launches directly inside SamTill POS (`/app/login`) in its own
                window and requires sign-in when logged out.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
