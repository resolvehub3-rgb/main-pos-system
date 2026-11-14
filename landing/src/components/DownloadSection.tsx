import {useState} from 'react';
import {
  detectInstallPlatform,
  promptInstall,
  type InstallPlatform,
} from '../../../src/lib/pwa';
import {SITE} from '../config/site';
import {Reveal} from './Reveal';
import {INSTALL_PLATFORMS, usePwaInstallStatus} from './SmartInstallButton';

export default function DownloadSection() {
  const status = usePwaInstallStatus();
  const [selectedPlatform, setSelectedPlatform] = useState<InstallPlatform>(() =>
    typeof navigator === 'undefined' ? 'chrome-windows' : detectInstallPlatform(navigator.userAgent),
  );
  const [promptMessage, setPromptMessage] = useState<string | null>(null);

  async function handleInstallClick() {
    setPromptMessage(null);
    if (status === 'installable') {
      const outcome = await promptInstall();
      if (outcome === 'dismissed') {
        setPromptMessage(
          'Installation was cancelled. Whenever you are ready, use the button again or follow the browser guide below.',
        );
      } else if (outcome === 'unavailable') {
        setPromptMessage(
          'Automatic prompt is not active in this view. Use the platform steps below or click Open SamTill App to Install.',
        );
      }
      return;
    }
    setPromptMessage(
      'Follow the instructions below for your browser, or open the POS app directly to trigger your browser install icon.',
    );
  }

  return (
    <section id="download" className="bg-slate-50 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <p className="text-sm font-bold uppercase tracking-widest text-amber-700">
            Install &amp; Download
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
            Install SamTill POS on your counter computer or mobile device
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-600">
            SamTill is an installable Progressive Web App (PWA). Installing puts SamTill POS in its
            own dedicated app window — separate from browser tabs — opening directly to your POS
            login and terminal.
          </p>
        </Reveal>

        <Reveal delayMs={80}>
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
              <div>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                    status === 'installed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : status === 'installable'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {status === 'installed'
                    ? 'Installed on this device'
                    : status === 'installable'
                      ? 'Ready for instant browser install'
                      : 'Manual browser installation available'}
                </span>
                <h2 className="mt-3 text-xl font-extrabold text-navy-950">
                  {status === 'installed'
                    ? 'SamTill POS is installed and ready'
                    : 'Install SamTill POS App'}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {status === 'installed'
                    ? 'Launch the installed POS workspace directly at /app/.'
                    : 'Opens directly into the isolated SamTill POS workspace (/app/login).'}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                {status === 'installed' ? (
                  <a
                    href={SITE.webAppUrl}
                    className="inline-flex items-center justify-center rounded-full bg-amber-700 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
                  >
                    Open SamTill
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleInstallClick()}
                    className="inline-flex items-center justify-center rounded-full bg-amber-700 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
                  >
                    Install SamTill
                  </button>
                )}
                <a
                  href="/app/login?install=1"
                  className="inline-flex items-center justify-center rounded-full border-2 border-navy-900 px-6 py-3.5 text-sm font-bold text-navy-900 transition-colors hover:border-amber-600 hover:text-amber-700"
                >
                  Open Web POS →
                </a>
              </div>
            </div>

            {promptMessage && (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                {promptMessage}
              </p>
            )}
          </div>
        </Reveal>

        <Reveal delayMs={140}>
          <div className="mt-10">
            <h2 className="text-xl font-extrabold text-navy-900">
              Platform-by-platform installation instructions
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {INSTALL_PLATFORMS.map((platform) => (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => setSelectedPlatform(platform.id)}
                  className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                    selectedPlatform === platform.id
                      ? 'bg-navy-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {platform.title}
                </button>
              ))}
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {INSTALL_PLATFORMS.map((platform) => {
                const highlighted = platform.id === selectedPlatform;
                return (
                  <article
                    key={platform.id}
                    className={`rounded-2xl border bg-white p-6 transition-shadow ${
                      highlighted ? 'border-amber-500 shadow-md' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-extrabold text-navy-900">{platform.title}</h3>
                      {highlighted && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                          Recommended for your device
                        </span>
                      )}
                    </div>
                    <ol className="mt-4 space-y-2.5 text-sm text-slate-600">
                      {platform.steps.map((step, index) => (
                        <li key={step} className="flex items-start gap-2.5">
                          <span className="font-bold text-amber-700">{index + 1}.</span>
                          <span className="leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </article>
                );
              })}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
