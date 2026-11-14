import {useEffect, useMemo, useState} from 'react';
import {
  getPwaInstallSnapshot,
  onInstallAvailable,
  promptInstall,
  type PwaInstallSnapshot,
} from '../../../src/lib/pwa.ts';
import {
  PLATFORM_INSTALL_GUIDES,
  detectInstallPlatform,
  type InstallPlatformId,
} from '../../../src/lib/pwaInstall.ts';
import {navigateMarketing} from '../lib/marketingRoute.ts';

interface SmartInstallControlProps {
  variant?: 'nav' | 'hero' | 'card';
  onNavigate?: (path: string) => void;
  showGuideInline?: boolean;
}

export default function SmartInstallControl({
  variant = 'hero',
  onNavigate,
  showGuideInline = false,
}: SmartInstallControlProps) {
  const [snapshot, setSnapshot] = useState<PwaInstallSnapshot>(() => getPwaInstallSnapshot());
  const [busy, setBusy] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<InstallPlatformId>(() =>
    detectInstallPlatform(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
  );

  useEffect(() => {
    setSnapshot(getPwaInstallSnapshot());
    return onInstallAvailable(() => {
      setSnapshot(getPwaInstallSnapshot());
    });
  }, []);

  const activeGuide = useMemo(
    () =>
      PLATFORM_INSTALL_GUIDES.find((guide) => guide.id === selectedPlatform) ??
      PLATFORM_INSTALL_GUIDES[0],
    [selectedPlatform],
  );

  const handleInstallClick = async () => {
    if (busy) return;
    setBusy(true);
    setDismissedNotice(false);
    try {
      const outcome = await promptInstall();
      setSnapshot(getPwaInstallSnapshot());
      if (outcome === 'dismissed') {
        setDismissedNotice(true);
      } else if (outcome === 'unavailable') {
        setGuideOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const go = (path: string) => {
    if (onNavigate) {
      onNavigate(path);
    } else {
      navigateMarketing(path);
    }
  };

  // ── NAV VARIANT ─────────────────────────────────────────────────────────────
  if (variant === 'nav') {
    if (snapshot.state === 'installed') {
      return (
        <a
          href="/app/"
          className="inline-flex items-center justify-center rounded-full border border-emerald-400/70 bg-emerald-500/15 px-4 py-2 text-sm font-bold text-emerald-200 transition-colors hover:bg-emerald-500/25"
        >
          Open SamTill
        </a>
      );
    }

    if (snapshot.state === 'installable') {
      return (
        <button
          type="button"
          onClick={handleInstallClick}
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full border border-amber-500 px-4 py-2 text-sm font-bold text-amber-300 transition-colors hover:bg-amber-500/10 hover:text-amber-200 disabled:opacity-60"
        >
          {busy ? 'Installing…' : 'Install SamTill'}
        </button>
      );
    }

    // State C (native install unsupported / unavailable in this browser session):
    // Navigate to /download where full browser-specific instructions are shown —
    // never render a broken install button.
    return (
      <a
        href="/download"
        onClick={(event) => {
          event.preventDefault();
          go('/download');
        }}
        className="inline-flex items-center justify-center rounded-full border border-amber-500 px-4 py-2 text-sm font-bold text-amber-300 transition-colors hover:bg-amber-500/10 hover:text-amber-200"
      >
        Install SamTill
      </a>
    );
  }

  // ── HERO / CARD VARIANTS ────────────────────────────────────────────────────
  const isCard = variant === 'card';

  return (
    <div className={isCard ? 'space-y-5' : 'space-y-4'}>
      {snapshot.state === 'installed' && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href="/app/"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-8 py-4 text-base font-bold text-white shadow-lg shadow-emerald-700/30 transition-colors hover:bg-emerald-700"
          >
            Open SamTill
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z"
                clipRule="evenodd"
              />
            </svg>
          </a>
          <p
            className={`text-sm font-medium ${
              isCard ? 'text-emerald-700' : 'text-emerald-300'
            }`}
          >
            SamTill POS is installed on this device. Opens your POS session directly.
          </p>
        </div>
      )}

      {snapshot.state === 'installable' && (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleInstallClick}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-700 px-8 py-4 text-base font-bold text-white shadow-lg shadow-amber-700/30 transition-colors hover:bg-amber-800 disabled:opacity-60"
            >
              {busy ? 'Opening install prompt…' : 'Install SamTill'}
            </button>
            <button
              type="button"
              onClick={() => setGuideOpen((open) => !open)}
              className={`inline-flex items-center justify-center rounded-full border px-6 py-4 text-sm font-bold transition-colors ${
                isCard
                  ? 'border-slate-300 text-navy-900 hover:border-amber-500 hover:text-amber-700'
                  : 'border-navy-500 text-white hover:border-amber-400 hover:text-amber-300'
              }`}
            >
              {guideOpen ? 'Hide manual steps' : 'Manual install steps'}
            </button>
          </div>
          {dismissedNotice && (
            <p className={`text-sm ${isCard ? 'text-slate-600' : 'text-navy-200'}`}>
              Installation prompt was dismissed. You can install anytime using your browser menu or
              from the{' '}
              <a
                href="/download"
                onClick={(event) => {
                  event.preventDefault();
                  go('/download');
                }}
                className="font-semibold underline hover:text-amber-400"
              >
                installation guide
              </a>
              .
            </p>
          )}
        </div>
      )}

      {snapshot.state === 'unsupported' && (
        <div className="space-y-3">
          <div
            className={`rounded-2xl border p-4 sm:p-5 ${
              isCard
                ? 'border-amber-200 bg-amber-50/70 text-navy-900'
                : 'border-navy-700 bg-navy-900/80 text-navy-100'
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p
                  className={`text-xs font-bold uppercase tracking-wider ${
                    isCard ? 'text-amber-700' : 'text-amber-300'
                  }`}
                >
                  Browser Installation Instructions · {activeGuide.label}
                </p>
                <p className={`mt-1 text-sm ${isCard ? 'text-slate-700' : 'text-navy-200'}`}>
                  One-click installation is unavailable in this browser session. Follow your
                  browser&apos;s quick setup step to add SamTill POS as a standalone app:
                </p>
              </div>
              {!showGuideInline && (
                <button
                  type="button"
                  onClick={() => setGuideOpen((open) => !open)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-colors ${
                    isCard
                      ? 'bg-navy-900 text-white hover:bg-navy-800'
                      : 'bg-amber-700 text-white hover:bg-amber-800'
                  }`}
                >
                  {guideOpen ? 'Hide instructions' : 'View install steps'}
                </button>
              )}
            </div>

            {!showGuideInline && !guideOpen && (
              <p className={`mt-3 text-xs font-medium ${isCard ? 'text-slate-600' : 'text-navy-300'}`}>
                Quick tip ({activeGuide.shortLabel}): {activeGuide.steps[1]}
              </p>
            )}
          </div>
        </div>
      )}

      {(showGuideInline || guideOpen) && (
        <div
          className={`rounded-2xl border p-5 ${
            isCard
              ? 'border-slate-200 bg-white text-navy-900 shadow-sm'
              : 'border-navy-700 bg-navy-900 text-white'
          }`}
        >
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Browser installation guides">
            {PLATFORM_INSTALL_GUIDES.map((guide) => {
              const active = guide.id === selectedPlatform;
              return (
                <button
                  key={guide.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedPlatform(guide.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    active
                      ? 'bg-amber-700 text-white'
                      : isCard
                        ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : 'bg-navy-800 text-navy-200 hover:bg-navy-700'
                  }`}
                >
                  {guide.label}
                </button>
              );
            })}
          </div>

          <ol
            className={`mt-4 space-y-2.5 text-sm leading-relaxed ${
              isCard ? 'text-slate-700' : 'text-navy-100'
            }`}
          >
            {activeGuide.steps.map((step, index) => (
              <li key={step} className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isCard
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-amber-600/20 text-amber-300'
                  }`}
                >
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <div
            className={`mt-4 flex flex-wrap items-center gap-4 border-t pt-4 ${
              isCard ? 'border-slate-200' : 'border-white/10'
            }`}
          >
            <a
              href="/app/login"
              className={`text-xs font-bold underline-offset-4 hover:underline ${
                isCard ? 'text-amber-700' : 'text-amber-400'
              }`}
            >
              Open SamTill POS Web Login (/app/login) →
            </a>
            {!isCard && (
              <a
                href="/download"
                onClick={(event) => {
                  event.preventDefault();
                  go('/download');
                }}
                className="text-xs font-semibold text-navy-200 underline-offset-4 hover:underline"
              >
                Full installation page →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
