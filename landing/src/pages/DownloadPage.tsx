import {PLATFORM_INSTALL_GUIDES} from '../../../src/lib/pwaInstall.ts';
import SmartInstallControl from '../components/SmartInstallControl';
import {Reveal} from '../components/Reveal';
import {navigateMarketing} from '../lib/marketingRoute';

interface DownloadPageProps {
  onNavigate?: (path: string) => void;
}

export default function DownloadPage({onNavigate}: DownloadPageProps) {
  const go = (path: string) => {
    if (onNavigate) onNavigate(path);
    else navigateMarketing(path);
  };

  return (
    <section className="bg-slate-50 py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-700">
            Install &amp; Launch
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-5xl">
            Install SamTill POS on Your Counter Device
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            SamTill runs both in your web browser and as an installed Progressive Web App (PWA)
            with offline checkout support. Installing creates a dedicated till shortcut that launches
            straight into the POS workspace.
          </p>
        </Reveal>

        <Reveal delayMs={80}>
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-navy-900">
                  Installation Status for This Device
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Your installed app and normal browser share the exact same business account,
                  inventory, and sales records.
                </p>
              </div>
              <a
                href="/app/login"
                className="inline-flex shrink-0 items-center justify-center rounded-full bg-navy-900 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-navy-800"
              >
                Open POS Login
              </a>
            </div>

            <div className="mt-6">
              <SmartInstallControl variant="card" onNavigate={go} showGuideInline />
            </div>
          </div>
        </Reveal>

        <Reveal delayMs={140} className="mt-14">
          <h2 className="text-2xl font-extrabold tracking-tight text-navy-900">
            Step-by-Step Browser Installation Guides
          </h2>
          <p className="mt-2 text-base text-slate-600">
            Choose your device and browser below if your browser does not show an automatic install
            prompt.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {PLATFORM_INSTALL_GUIDES.map((guide) => (
              <article
                key={guide.id}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-lg font-extrabold text-navy-900">{guide.label}</h3>
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                      {guide.browserName} · {guide.osName}
                    </p>
                  </div>
                </div>

                <ol className="mt-4 flex-1 space-y-3 text-sm leading-relaxed text-slate-700">
                  {guide.steps.map((step, index) => (
                    <li key={step} className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
