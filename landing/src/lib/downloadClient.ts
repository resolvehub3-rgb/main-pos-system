/**
 * Installer download request + response classification (pure logic).
 *
 * The browser asks `POST /api/download` with the customer's Supabase access
 * token; the server decides everything (session, access mode, release row,
 * signed URL) and this module only renders the outcome honestly:
 *
 * - success  → short-lived URL + release metadata (version, size, SHA-256)
 *              so the customer can verify what they downloaded;
 * - failure  → a precise, non-alarming message for each server answer
 *              (not signed in, access denied, installer not published,
 *              rate limited, backend unconfigured/unreachable…).
 *
 * Nothing here can grant access — it never computes, fakes or bypasses an
 * authorisation decision, and it never invents a URL.
 */

export interface DownloadRelease {
  version: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
}

export type DownloadFailureKind =
  | 'auth_required'
  | 'session_expired'
  | 'access_denied'
  | 'installer_unavailable'
  | 'rate_limited'
  | 'backend_unavailable'
  | 'not_configured'
  | 'api_missing'
  | 'network'
  | 'invalid_response';

export type DownloadResult =
  | {ok: true; url: string; expiresAt: string; release: DownloadRelease}
  | {
      ok: false;
      kind: DownloadFailureKind;
      message: string;
      /** Machine-readable deny reason from the server, when present. */
      reason?: string;
      validTo?: string | null;
      retryAfterSeconds?: number;
      /** True when retrying the same request can help. */
      retryable: boolean;
    };

const SERVER_MESSAGES: Record<string, string> = {
  authentication_required: 'Sign in with your SamTill account to download the installer.',
  invalid_session: 'Your session has expired. Sign in again to download the installer.',
  download_denied: 'Your account does not have installer access yet.',
  download_unavailable: 'The installer has not been published for download yet.',
  rate_limited: 'Too many download requests. Please wait a few minutes and try again.',
  backend_unavailable: 'The download service is busy right now. Please try again shortly.',
  signing_failed: 'Could not create a download link. Please try again shortly.',
  audit_unavailable: 'Could not record this download. Please try again shortly.',
  commerce_not_configured: 'Installer downloads are not configured on this deployment yet.',
};

function failure(
  kind: DownloadFailureKind,
  message: string,
  extra: {reason?: string; validTo?: string | null; retryAfterSeconds?: number; retryable?: boolean} = {},
): DownloadResult {
  return {
    ok: false,
    kind,
    message,
    retryable: extra.retryable ?? false,
    ...(extra.reason !== undefined ? {reason: extra.reason} : {}),
    ...(extra.validTo !== undefined ? {validTo: extra.validTo} : {}),
    ...(extra.retryAfterSeconds !== undefined ? {retryAfterSeconds: extra.retryAfterSeconds} : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Map one HTTP response from POST /api/download to a DownloadResult.
 * Exported separately so every branch is unit-tested without a network.
 */
export function classifyDownloadResponse(
  status: number,
  body: unknown,
  retryAfterSeconds?: number,
): DownloadResult {
  const record = isRecord(body) ? body : {};
  const code = typeof record.error === 'string' ? record.error : '';
  const serverMessage = typeof record.message === 'string' ? record.message : '';

  if (status === 200) {
    const url = typeof record.url === 'string' ? record.url : '';
    const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : '';
    const release = isRecord(record.release) ? record.release : null;
    if (
      url === '' ||
      expiresAt === '' ||
      !release ||
      typeof release.version !== 'string' ||
      typeof release.filename !== 'string' ||
      typeof release.sizeBytes !== 'number' ||
      typeof release.sha256 !== 'string'
    ) {
      return failure('invalid_response', 'The download service returned an unexpected answer. Please try again.', {retryable: true});
    }
    return {
      ok: true,
      url,
      expiresAt,
      release: {
        version: release.version,
        filename: release.filename,
        sizeBytes: release.sizeBytes,
        sha256: release.sha256,
      },
    };
  }

  if (status === 401) {
    const kind = code === 'invalid_session' ? 'session_expired' : 'auth_required';
    return failure(kind, SERVER_MESSAGES[code] ?? SERVER_MESSAGES.authentication_required);
  }

  if (status === 403) {
    if (code === 'download_unavailable') {
      return failure('installer_unavailable', SERVER_MESSAGES.download_unavailable);
    }
    if (code === 'download_denied') {
      const reason = typeof record.reason === 'string' ? record.reason : undefined;
      const validTo = typeof record.validTo === 'string' ? record.validTo : null;
      return failure('access_denied', serverMessage || SERVER_MESSAGES.download_denied, {
        reason,
        validTo,
      });
    }
    return failure('access_denied', serverMessage || SERVER_MESSAGES.download_denied);
  }

  if (status === 404) {
    return failure('api_missing', 'The download service is not available on this deployment yet.');
  }

  if (status === 429) {
    return failure('rate_limited', SERVER_MESSAGES.rate_limited, {
      retryAfterSeconds,
      retryable: true,
    });
  }

  if (status === 503) {
    if (code === 'commerce_not_configured') {
      return failure('not_configured', SERVER_MESSAGES.commerce_not_configured);
    }
    return failure('backend_unavailable', serverMessage || SERVER_MESSAGES.backend_unavailable, {
      retryable: true,
    });
  }

  if (status === 502) {
    return failure('backend_unavailable', SERVER_MESSAGES.backend_unavailable, {retryable: true});
  }

  return failure('backend_unavailable', serverMessage || SERVER_MESSAGES.backend_unavailable, {
    retryable: true,
  });
}

export interface DownloadRequestOptions {
  /** '' = same origin (Vercel deployment); otherwise the API base URL. */
  apiBase?: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

/**
 * Ask the API for a short-lived signed installer URL.
 * Throws nothing: network failures become a `network` result.
 */
export async function requestInstallerDownload(
  options: DownloadRequestOptions,
): Promise<DownloadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${(options.apiBase ?? '').replace(/\/+$/, '')}/api/download`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.accessToken}`,
      },
      body: '{}',
      cache: 'no-store',
    });
  } catch {
    return failure('network', 'Could not reach the download service. Check your connection and try again.', {retryable: true});
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const retryHeader = response.headers.get('retry-after');
  const retryAfter = retryHeader ? Number.parseInt(retryHeader, 10) : undefined;
  return classifyDownloadResponse(
    response.status,
    body,
    retryAfter !== undefined && Number.isFinite(retryAfter) ? retryAfter : undefined,
  );
}

/** Human-readable file size for the release metadata panel. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown size';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

/**
 * PowerShell one-liner the customer can run to confirm the downloaded file
 * matches the SHA-256 published by the server.
 */
export function sha256VerificationCommand(filename: string): string {
  const safeName = filename.replace(/[^\w.\- ]/g, '');
  return `Get-FileHash -Algorithm SHA256 ".\\${safeName}"`;
}
