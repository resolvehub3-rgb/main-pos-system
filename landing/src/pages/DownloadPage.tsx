import {useState} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import {COMMERCE} from '../config/commerce';
import {SITE} from '../config/site';
import {downloadAvailability} from '../lib/availability';
import {readCommerceEnv} from '../lib/commerceClient';
import {
  formatFileSize,
  requestInstallerDownload,
  sha256VerificationCommand,
  type DownloadResult,
} from '../lib/downloadClient';
import {loginHref} from '../lib/navigation';
import {useAccountSession} from '../lib/useAccountSession';

/**
 * Authenticated installer download screen.
 *
 * The page asks `POST /api/download` for a short-lived signed URL. The
 * server decides whether this customer may download (session, access mode,
 * active release) — nothing is granted or assumed client-side. Failures are
 * rendered from the classified response: not signed in, access denied,
 * installer not published, rate limited, backend unconfigured or unreachable.
 *
 * Release metadata (version, size, SHA-256) comes from the server so the
 * customer can verify the file they received. The Windows installer and the
 * web/PWA option are presented as the separate ways of running SamTill.
 */

type Phase = 'idle' | 'requesting' | 'ready' | 'failed';

export default function DownloadPage() {
  const availability = downloadAvailability(COMMERCE, readCommerceEnv());
  const {loading, account, signOut} = useAccountSession();
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<DownloadResult | null>(null);
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);

  async function handleRequest() {
    if (!account) return;
    setBanner(null);
    setPhase('requesting');
    const response = await requestInstallerDownload({
      apiBase: readCommerceEnv().apiBase,
      accessToken: account.accessToken,
    });
    setResult(response);
    setPhase(response.ok ? 'ready' : 'failed');
  }

  if (!availability.available) {
    return (
      <AccountShell title="Download SamTill" subtitle="Windows installer">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  if (loading) {
    return (
      <AccountShell title="Download SamTill" subtitle="Windows installer">
        <p className="text-sm text-navy-700">Checking your session…</p>
      </AccountShell>
    );
  }

  if (!account) {
    return (
      <AccountShell
        title="Download SamTill"
        subtitle="Windows installer"
        footer={
          <a href="#/register" className="font-semibold text-amber-700 underline-offset-4 hover:underline">
            Create an account →
          </a>
        }
      >
        <GateNotice
          notice="Sign in with your SamTill account to get your installer download link."
          actionHref={loginHref('/download')}
          actionLabel="Sign in"
        />
      </AccountShell>
    );
  }

  const failure = result && !result.ok ? result : null;
  const release = result && result.ok ? result.release : null;

  return (
    <AccountShell
      title="Download SamTill"
      subtitle="The genuine SamTill Windows installer, issued to your account through a short-lived secure link."
      footer={
        <a href="#/account" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
          ← Back to my account
        </a>
      }
    >
      {banner && <StatusBanner tone={banner.tone}>{banner.message}</StatusBanner>}

      {phase === 'idle' && (
        <>
          <p className="text-sm leading-relaxed text-navy-700">
            We will prepare a download link that is valid for a few minutes and is tied to your
            account. The installer is a large Windows file, so the download may take a little
            while.
          </p>
          <button
            type="button"
            onClick={handleRequest}
            className="mt-5 w-full rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Get download link
          </button>
        </>
      )}

      {phase === 'requesting' && (
        <div className="flex items-center gap-3 text-sm text-navy-700" role="status">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-navy-300 border-t-amber-600" />
          Requesting a secure download link… (the installer is large — your browser will show the
          file download progress once it starts)
        </div>
      )}

      {phase === 'ready' && release && result && result.ok && (
        <div>
          <StatusBanner tone="success">
            Your download link is ready. It expires automatically a few minutes after it is issued.
          </StatusBanner>

          <dl className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
            <div>
              <dt className="font-bold text-navy-900">File</dt>
              <dd className="mt-0.5 text-navy-700">{release.filename}</dd>
            </div>
            <div>
              <dt className="font-bold text-navy-900">Version</dt>
              <dd className="mt-0.5 text-navy-700">{release.version}</dd>
            </div>
            <div>
              <dt className="font-bold text-navy-900">Size</dt>
              <dd className="mt-0.5 text-navy-700">
                {formatFileSize(release.sizeBytes)} ({release.sizeBytes.toLocaleString('en-GH')}{' '}
                bytes)
              </dd>
            </div>
            <div>
              <dt className="font-bold text-navy-900">SHA-256</dt>
              <dd className="mt-0.5 break-all font-mono text-xs text-navy-700">{release.sha256}</dd>
            </div>
            <div>
              <dt className="font-bold text-navy-900">Link valid until</dt>
              <dd className="mt-0.5 text-navy-700">
                {new Date(result.expiresAt).toLocaleString('en-GH')}
              </dd>
            </div>
          </dl>

          <a
            href={result.url}
            className="mt-5 block w-full rounded-full bg-amber-700 px-6 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-amber-800"
          >
            Download {release.filename} ({formatFileSize(release.sizeBytes)})
          </a>

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600">
            <p className="font-bold text-navy-900">Verify the file (optional)</p>
            <p className="mt-1">
              After the download finishes, compare this command's output with the SHA-256 shown
              above:
            </p>
            <code className="mt-2 block overflow-x-auto rounded bg-slate-100 px-2 py-1.5 text-xs">
              {sha256VerificationCommand(release.filename)}
            </code>
            <p className="mt-2">
              Windows SmartScreen may warn because the current build is not code-signed — SamTeck
              Digital is the publisher.
            </p>
          </div>

          <button
            type="button"
            onClick={handleRequest}
            className="mt-4 text-sm font-semibold text-navy-700 underline-offset-4 hover:text-amber-700 hover:underline"
          >
            Generate a new link
          </button>
        </div>
      )}

      {phase === 'failed' && failure && (
        <div>
          <StatusBanner tone="error">{failure.message}</StatusBanner>

          {failure.kind === 'access_denied' && (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Installer access is granted with your SamTill account. If you believe this is a
              mistake, contact SamTeck Digital.
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            {(failure.kind === 'auth_required' || failure.kind === 'session_expired') && (
              <a href={loginHref('/download')} className="text-amber-700 underline-offset-4 hover:underline">
                Sign in again →
              </a>
            )}
            {(failure.retryable || failure.kind === 'rate_limited') && (
              <button
                type="button"
                onClick={handleRequest}
                className="text-navy-700 underline-offset-4 hover:underline"
              >
                Try again{failure.retryAfterSeconds ? ` in ~${failure.retryAfterSeconds}s` : ''} →
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setPhase('idle');
              }}
              className="text-navy-700 underline-offset-4 hover:underline"
            >
              Back
            </button>
          </div>
        </div>
      )}

      <hr className="my-6 border-slate-200" />

      <div className="text-sm leading-relaxed text-navy-700">
        <h2 className="text-sm font-bold text-navy-900">Other ways to run SamTill</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>
            <strong>Windows installer (this page):</strong> installs SamTill on one Windows 10/11
            computer for shop use.
          </li>
          <li>
            <strong>Web / PWA:</strong> SamTill also runs in your browser and can be installed as a
            Progressive Web App from the browser's install menu.{' '}
            {SITE.webAppUrl ? (
              <a
                href={SITE.webAppUrl}
                className="font-semibold text-amber-700 underline-offset-4 hover:underline"
              >
                Open the SamTill web app →
              </a>
            ) : (
              'Ask SamTeck Digital for your current web link during setup.'
            )}
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Your account provides downloads only — it does not activate a POS licence and no payment
          is taken here. Signed in as {account.email ?? 'your account'}.{' '}
          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            className="font-semibold text-navy-700 underline underline-offset-4 hover:text-amber-700"
          >
            Sign out
          </button>
        </p>
      </div>
    </AccountShell>
  );
}
