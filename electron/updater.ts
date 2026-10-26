/**
 * Update *notification* architecture (no silent downloads, no code execution).
 *
 * The desktop app checks a small JSON release manifest published by the
 * SamTill release process and tells the cashier when a newer installer exists.
 * Nothing is downloaded or executed by the app: the cashier explicitly opens
 * the publisher-hosted download page in the OS browser and runs the installer
 * themselves, after the OS/smart-screen checks.
 *
 * The manifest URL is baked in at build time (see `scripts/build-electron.mjs`):
 *
 *     SAMTILL_UPDATE_MANIFEST_URL=... pnpm desktop:build
 *
 * Without it every check honestly returns `not-configured`. See
 * docs/ELECTRON.md for the manifest format and the publishing checklist.
 */
import type {UpdateStatus} from '../src/types/desktop';

/** Injected by esbuild (`scripts/build-electron.mjs`); '' when not configured. */
declare const __UPDATE_MANIFEST_URL__: string;

const CHECK_TIMEOUT_MS = 8_000;

/** `1.2.3` → [1, 2, 3]; null when the value isn't a plain dotted version. */
function parseVersion(value: unknown): number[] | null {
  if (typeof value !== 'string') return null;
  if (!/^\d+(\.\d+){0,3}$/.test(value.trim())) return null;
  return value.trim().split('.').map((n) => Number.parseInt(n, 10));
}

function isNewerVersion(candidate: number[], current: number[]): boolean {
  const len = Math.max(candidate.length, current.length);
  for (let i = 0; i < len; i++) {
    const a = candidate[i] ?? 0;
    const b = current[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

interface ReleaseManifest {
  version: string;
  notes?: string;
  url?: string;
  sha256?: string;
}

/**
 * Check the release manifest for a newer desktop version.
 *
 * Never throws and never installs anything. Hardening:
 *  - manifest must come from https (plain http only allowed for loopback, for
 *    local testing of the release pipeline),
 *  - the download URL must live on the same origin as the manifest, so a
 *    compromised path can't redirect the cashier to an arbitrary host,
 *  - both values are validated before being shown to the user.
 */
export async function checkForUpdates(currentVersion: string): Promise<UpdateStatus> {
  const manifestUrl = (typeof __UPDATE_MANIFEST_URL__ === 'string' ? __UPDATE_MANIFEST_URL__ : '').trim();
  if (!manifestUrl) return {state: 'not-configured'};

  if (!isHttpUrl(manifestUrl)) {
    return {state: 'error', message: 'Update manifest URL is not a valid http(s) URL.'};
  }

  let manifestOrigin: string;
  try {
    const parsed = new URL(manifestUrl);
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) {
      return {state: 'error', message: 'Update manifest must be served over https.'};
    }
    manifestOrigin = parsed.origin;
  } catch {
    return {state: 'error', message: 'Update manifest URL is invalid.'};
  }

  try {
    const response = await fetch(manifestUrl, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: {Accept: 'application/json'},
      redirect: 'error',
    });
    if (!response.ok) {
      return {state: 'error', message: `Update manifest responded ${response.status}.`};
    }
    const manifest = (await response.json()) as ReleaseManifest;

    const remoteVersion = parseVersion(manifest?.version);
    if (!remoteVersion) {
      return {state: 'error', message: 'Update manifest has no valid version.'};
    }

    const current = parseVersion(currentVersion) ?? [0];
    if (!isNewerVersion(remoteVersion, current)) {
      return {state: 'up-to-date', version: currentVersion};
    }

    const notes = typeof manifest.notes === 'string' ? manifest.notes.slice(0, 500) : '';
    if (typeof manifest.url !== 'string' || !isHttpUrl(manifest.url)) {
      return {state: 'error', message: 'Update manifest has no valid download URL.'};
    }
    const downloadUrl = new URL(manifest.url);
    if (downloadUrl.origin !== manifestOrigin) {
      return {state: 'error', message: 'Update download URL is not hosted with the release manifest.'};
    }

    return {
      state: 'available',
      version: manifest.version.trim(),
      currentVersion,
      notes,
      url: downloadUrl.toString(),
    };
  } catch (err) {
    return {
      state: 'error',
      message: err instanceof Error ? err.message : 'Update check failed.',
    };
  }
}
