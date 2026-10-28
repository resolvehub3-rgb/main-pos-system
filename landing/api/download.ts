/**
 * POST /api/download — issue a short-lived signed URL for the installer.
 *
 * STATUS: implemented; requires the commerce backend (503 until configured)
 *         and a signed-in customer. Access is decided by DOWNLOAD_ACCESS_MODE
 *         (`entitlement` by default; `verified_account` is an explicit
 *         owner opt-in while payments are postponed). Not yet exercised
 *         against live storage — see docs/02-commerce-architecture.md and
 *         docs/05-customer-journey.md.
 *
 * AUTHORISATION FLOW (all decisions server-side; the request body is
 * ignored — the client cannot influence any step):
 *   1. require a valid commerce session (Bearer token),
 *   2. rate limit per user (6 links / 10 minutes),
 *   3. decide access by DOWNLOAD_ACCESS_MODE (server-side, see below),
 *   4. load the current ACTIVE release (version, path, SHA-256 chosen by
 *      the server, never by the client),
 *   5. mint a signed URL valid for DOWNLOAD_LINK_TTL_SECONDS (default 300 s)
 *      using the service-role key (server-side only),
 *   6. record the grant in download_events — FAIL CLOSED: if the audit row
 *      cannot be written, no URL is returned,
 *   7. return the URL plus release metadata (version, size, SHA-256) so the
 *      customer can verify the file after download.
 *
 * ACCESS MODES (env DOWNLOAD_ACCESS_MODE, default `entitlement`):
 *   - `entitlement`      → active paid entitlement required (original
 *                          behaviour; deny reasons audited as before);
 *   - `verified_account` → any signed-in commerce customer may download the
 *                          installer FILE while payments are postponed, so
 *                          the register → verify → sign in → download
 *                          journey works. Requires "Confirm email" in the
 *                          commerce project (an unconfirmed address cannot
 *                          obtain a session). This is NOT a POS licence
 *                          activation and charges nothing.
 *
 * Denied attempts are audited too (best-effort) so refused downloads are
 * visible in review.
 *
 * LIMITATION: this controls delivery of the installer FILE only. It does not
 * enforce the licence inside an installed copy of SamTill — that is a
 * separate POS integration requiring explicit approval
 * (docs/04-installer-delivery-and-licensing.md).
 */

import {writeAudit} from './_lib/audit.ts';
import {
  loadEntitlementsForUser,
  type EntitlementRowFull,
} from './_lib/context.ts';
import {getCommerceConfig, type CommerceConfig} from './_lib/env.ts';
import {
  clientIp,
  apiError,
  json,
  methodGuard,
  notConfigured,
  rateLimited,
  sha256Hex,
} from './_lib/http.ts';
import {
  evaluateDownloadAccess,
  toDownloadEventResult,
  type DownloadDecisionReason,
} from './_lib/entitlement.ts';
import {checkRateLimit, sharedBuckets} from './_lib/rate-limit.ts';
import {requireSession} from './_lib/session.ts';
import {createSignedObjectUrl, insertRow, selectRows} from './_lib/supabase.ts';

const DOWNLOAD_RATE = {limit: 6, windowMs: 10 * 60 * 1000};

interface ReleaseRow {
  id: string;
  version: string;
  filename: string;
  storage_path: string;
  sha256: string;
  size_bytes: number;
}

function denyMessage(reason: DownloadDecisionReason): string {
  switch (reason) {
    case 'no_entitlement':
      return 'Your account does not include installer downloads yet.';
    case 'wrong_product':
      return 'Your access does not cover this product.';
    case 'not_yet_active':
      return 'Your access period has not started yet.';
    case 'expired':
      return 'Your access period has ended. Renew to download again.';
    case 'inactive_status':
      return 'Your access is currently inactive. Please contact support.';
    default:
      return 'Download not available.';
  }
}

async function findActiveRelease(config: CommerceConfig): Promise<ReleaseRow | null> {
  const rows = await selectRows<ReleaseRow>(
    config,
    'installer_releases',
    'is_active=eq.true&product_code=eq.samtill-pos&select=id,version,filename,storage_path,sha256,size_bytes&order=published_at.desc&limit=1',
  );
  return rows[0] ?? null;
}

export async function POST(request: Request): Promise<Response> {
  const guard = methodGuard(request, 'POST');
  if (guard) return guard;

  const configResult = getCommerceConfig();
  if (!configResult.ok) return notConfigured(configResult.missing, configResult.invalid);
  const config = configResult.config;

  const session = await requireSession(request, config);
  if (!session.ok) return session.response;
  const userId = session.user.userId;

  const rate = checkRateLimit(sharedBuckets, `download:${userId}`, DOWNLOAD_RATE, Date.now());
  if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

  const now = new Date();
  let decision: ReturnType<typeof evaluateDownloadAccess>;
  if (config.downloadAccessMode === 'verified_account') {
    // Owner-enabled mode: every signed-in customer of the commerce project
    // may fetch the installer FILE (session + rate limit + audit above/below
    // still apply). Email verification is enforced by the project's
    // "Confirm email" setting — an unconfirmed address never gets a session.
    decision = {allowed: true, reason: 'granted'};
  } else {
    try {
      const entitlements: EntitlementRowFull[] = await loadEntitlementsForUser(config, userId);
      decision = evaluateDownloadAccess(entitlements, {now});
    } catch (cause) {
      console.error(`commerce: download entitlement load failed: ${String(cause)}`);
      return apiError(502, 'backend_unavailable', 'Could not check your access right now. Please try again shortly.');
    }
  }

  let release: ReleaseRow | null = null;
  try {
    release = await findActiveRelease(config);
  } catch (cause) {
    if (decision.allowed) {
      console.error(`commerce: download release load failed: ${String(cause)}`);
      return apiError(502, 'backend_unavailable', 'Could not load the release right now. Please try again shortly.');
    }
    // Denied anyway — fall through without an audit row.
  }

  if (!decision.allowed) {
    // Best-effort denial audit (only possible once a release row exists).
    if (release) {
      try {
        await insertRow(config, 'download_events', {
          user_id: userId,
          release_id: release.id,
          granted_at: now.toISOString(),
          link_expires_at: now.toISOString(),
          ip_hash: config.auditHashSalt
            ? await sha256Hex(`${config.auditHashSalt}:${clientIp(request) ?? 'unknown'}`)
            : null,
          user_agent: (request.headers.get('user-agent') ?? '').slice(0, 300) || null,
          result: toDownloadEventResult(decision),
        });
      } catch (cause) {
        console.error(`commerce: denial audit failed: ${String(cause)}`);
      }
    }
    return apiError(403, 'download_denied', denyMessage(decision.reason), {
      extra: {reason: decision.reason, validTo: decision.validTo ?? null},
    });
  }

  if (!release) {
    return apiError(403, 'download_unavailable', 'The installer is not available for download yet.');
  }

  let url: string;
  try {
    url = await createSignedObjectUrl(
      config,
      config.installerBucket,
      release.storage_path,
      config.downloadLinkTtlSeconds,
    );
  } catch (cause) {
    console.error(`commerce: signed URL creation failed: ${String(cause)}`);
    return apiError(502, 'signing_failed', 'Could not create a download link. Please try again shortly.');
  }

  const expiresAtMs = Date.now() + config.downloadLinkTtlSeconds * 1000;
  const ipHash = config.auditHashSalt
    ? await sha256Hex(`${config.auditHashSalt}:${clientIp(request) ?? 'unknown'}`)
    : null;

  try {
    await insertRow(config, 'download_events', {
      user_id: userId,
      release_id: release.id,
      granted_at: now.toISOString(),
      link_expires_at: new Date(expiresAtMs).toISOString(),
      ip_hash: ipHash,
      user_agent: (request.headers.get('user-agent') ?? '').slice(0, 300) || null,
      result: 'granted',
    });
  } catch (cause) {
    // Fail closed: never hand out an unaudited installer link.
    console.error(`commerce: download audit write failed: ${String(cause)}`);
    return apiError(503, 'audit_unavailable', 'Could not record this download. Please try again shortly.');
  }

  await writeAudit(config, {
    actorUserId: userId,
    actorSystem: 'authenticated',
    action: 'download_granted',
    entity: 'installer_release',
    entityId: release.id,
    metadata: {version: release.version, sha256: release.sha256.toLowerCase()},
    ipHash,
  });

  return json({
    url,
    expiresAt: new Date(expiresAtMs).toISOString(),
    release: {
      version: release.version,
      filename: release.filename,
      sizeBytes: release.size_bytes,
      sha256: release.sha256.toLowerCase(),
    },
  });
}
