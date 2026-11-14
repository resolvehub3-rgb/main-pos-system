import {useEffect, useState} from 'react';
import {
  detectInstallPlatform,
  getPwaInstallState,
  onInstallAvailable,
  promptInstall,
  type InstallPlatform,
  type PwaInstallState,
} from '../../../src/lib/pwa';
import {SITE} from '../config/site';
import {navigateRoute} from '../lib/navigation';

export const INSTALL_PLATFORMS: Array<{
  id: InstallPlatform;
  title: string;
  steps: string[];
}> = [
  {
    id: 'chrome-windows',
    title: 'Chrome on Windows',
    steps: [
      'Open SamTill POS at /app/login in Google Chrome.',
      'Click the Install SamTill icon in the right side of the address bar, or open the Chrome menu (⋮) → Cast, save, and share → Install page as app.',
      'Click Install to launch SamTill POS in its own dedicated window.',
    ],
  },
  {
    id: 'edge-windows',
    title: 'Microsoft Edge on Windows',
    steps: [
      'Open SamTill POS at /app/login in Microsoft Edge.',
      'Click the App available (+) icon in the address bar, or open Settings and more (…) → Apps → Install this site as an app.',
      'Click Install to pin SamTill POS to your Windows Start menu and taskbar.',
    ],
  },
  {
    id: 'chrome-android',
    title: 'Chrome on Android',
    steps: [
      'Open SamTill POS at /app/login in Chrome for Android.',
      'Tap the Chrome menu (⋮) in the top right corner and choose Install app or Add to Home screen.',
      'Confirm Install to open SamTill POS full-screen from your Home screen.',
    ],
  },
  {
    id: 'safari-ios',
    title: 'Safari on iPhone & iPad',
    steps: [
      'Open SamTill POS at /app/login in Safari (not an in-app browser).',
      'Tap the Share button at the bottom or top toolbar.',
      'Scroll down, tap Add to Home Screen, then tap Add.',
    ],
  },
];

export function usePwaInstallStatus(): PwaInstallState {
  const [state, setState] = useState<PwaInstallState>(() =>
    typeof window === 'undefined' ? 'unsupported' : getPwaInstallState(),
  );

  useEffect(() => {
    setState(getPwaInstallState());
    return onInstallAvailable(() => {
      setState(getPwaInstallState());
    });
  }, []);

  return state;
}

export function InstallInstructionsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<InstallPlatform>(() =>
    typeof navigator === 'undefined' ? 'chrome-windows' : detectInstallPlatform(navigator.userAgent),
  );

  if (!open) return null;

  const selectedGuide =
    INSTALL_PLATFORMS.find((item) => item.id === activeTab) ?? INSTALL_PLATFORMS[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-install-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-navy-950/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-700">
              Install SamTill POS App
            </p>
            <h2 id="smart-install-title" className="mt-1 text-xl font-extrabold text-navy-950">
              Install on your computer or mobile device
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close installation guide"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-navy-900"
          >
            ✕
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Your browser did not present an automatic install prompt on this marketing page. Open the
          POS app scope or follow the steps for your browser below:
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {INSTALL_PLATFORMS.map((platform) => (
            <button
              key={platform.id}
              type="button"
              onClick={() => setActiveTab(platform.id)}
              className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                activeTab === platform.id
                  ? 'bg-navy-900 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {platform.title}
            </button>
          ))}
        </div>

        <ol className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-navy-900">
          {selectedGuide.steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-white">
                {index + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <a
            href="/app/login?install=1"
            className="inline-flex items-center justify-center rounded-full bg-amber-700 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Open SamTill App to Install →
          </a>
          <a
            href="/download"
            onClick={(event) => {
              event.preventDefault();
              onClose();
              navigateRoute('/download');
            }}
            className="text-sm font-semibold text-navy-700 underline-offset-4 hover:text-amber-700 hover:underline"
          >
            Full download &amp; setup page
          </a>
        </div>
      </div>
    </div>
  );
}

export default function SmartInstallButton({
  variant = 'nav',
  onAction,
}: {
  variant?: 'nav' | 'hero' | 'mobile';
  onAction?: () => void;
}) {
  const status = usePwaInstallStatus();
  const [modalOpen, setModalOpen] = useState(false);
  const [dismissNote, setDismissNote] = useState(false);

  const className =
    variant === 'hero'
      ? 'inline-flex items-center justify-center rounded-full border-2 border-navy-400 px-8 py-4 text-base font-bold text-white transition-colors hover:border-amber-400 hover:text-amber-300'
      : variant === 'mobile'
        ? 'block w-full rounded-full border border-amber-500 px-5 py-3 text-center text-base font-bold text-amber-300 transition-colors hover:bg-amber-500/10'
        : 'inline-flex items-center rounded-full border border-amber-500 px-4 py-2 text-sm font-bold text-amber-300 transition-colors hover:bg-amber-500/10 hover:text-amber-200';

  if (status === 'installed') {
    return (
      <a href={SITE.webAppUrl} onClick={onAction} className={className}>
        Open SamTill
      </a>
    );
  }

  async function handleClick() {
    onAction?.();
    if (status === 'installable') {
      const outcome = await promptInstall();
      if (outcome === 'dismissed') {
        setDismissNote(true);
      } else if (outcome === 'unavailable') {
        setModalOpen(true);
      }
      return;
    }
    setModalOpen(true);
  }

  return (
    <>
      <button type="button" onClick={() => void handleClick()} className={className}>
        Install SamTill
      </button>
      {dismissNote && variant === 'hero' && (
        <span className="self-center text-xs text-navy-200">
          Install dismissed — you can install anytime from Download.
        </span>
      )}
      <InstallInstructionsModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
