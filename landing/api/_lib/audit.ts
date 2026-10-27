/**
 * Append-only audit trail helper.
 *
 * Audit rows record security-relevant actions (checkout created, payment
 * verified, webhook applied/failed, download granted/denied). Writes are
 * best-effort: a failed audit insert must never take down the operation it
 * is observing — the failure itself is logged to the function console.
 */

import type {CommerceConfig} from './env.ts';
import {insertRow} from './supabase.ts';

export interface AuditEntry {
  actorUserId?: string | null;
  actorSystem?: 'service_role' | 'authenticated';
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
}

export async function writeAudit(cfg: CommerceConfig, entry: AuditEntry): Promise<void> {
  try {
    await insertRow(cfg, 'audit_logs', {
      actor_user_id: entry.actorUserId ?? null,
      actor_system: entry.actorSystem ?? 'service_role',
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
      ip_hash: entry.ipHash ?? null,
    });
  } catch (cause) {
    console.error(`commerce: audit write failed (${entry.action}): ${String(cause)}`);
  }
}
