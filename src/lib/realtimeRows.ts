/**
 * Applying one realtime payload to an in-memory mirror row list.
 *
 * The app is local-first: Supabase realtime events are not rendered directly,
 * they are folded into the mirror (`DatabaseService`'s arrays) which then
 * notifies its subscribers. This module owns that fold so it is a pure,
 * testable function — the service only supplies the store, the payload's
 * resolved id and the normaliser for the table.
 *
 * ## Why the fold is not simply "upsert payload.new"
 *
 * Two identities exist for every row: the app id it was created under
 * (`sale-1761…`) and the deterministic UUID that id syncs under (sync.ts).
 * An event arrives keyed by the UUID. `resolveEchoId` (in the service) maps
 * it back — succeeding when THIS session wrote the row (registered by
 * `toUuid`) or adopted it earlier (registered by `bindMirrorId`) and failing
 * when the row belongs to another session that this mirror has never seen.
 *
 * The old handlers only edited rows the mirror already held and dropped
 * everything else, so a row created on another device (a shop registered
 * from the landing site, a sale rung up on another till, a product added
 * from the owner's phone) never reached this browser. For a super-admin
 * dashboard — whose whole job is to reflect the platform — that rendered as
 * permanently stale data.
 *
 * The rules, then:
 *
 *  • held row, UPDATE → merge in place. The value is rebuilt through the
 *                       table's normaliser rather than by spreading raw
 *                       columns over the held row, because a direct spread
 *                       destroys nested shapes (a sale's JSON items carry no
 *                       `sale_id`). The spread still runs underneath so the
 *                       server wins on every key the database owns, and any
 *                       key the normaliser does not produce is app-only (a
 *                       device-local password or PIN is deliberately never
 *                       mirrored), so it is carried across from the held row.
 *  • held row, INSERT → already current: this tab just wrote it.
 *  • held row, DELETE → remove it, so a deletion elsewhere propagates.
 *  • unknown row      → adopt (INSERT or UPDATE). RLS delivered the payload,
 *                       so the session is entitled to the row, and adoption
 *                       checks the mirror first, so it cannot duplicate.
 *                       Unknown DELETEs are no-ops — nothing here to remove.
 *
 * Returns whether the store changed, so the caller can persist and notify.
 */
import { bindMirrorId, toUuid } from './sync.ts';

export function applyRealtimeRow<T extends { id: string }>(
  store: T[],
  eventType: string,
  resolvedId: string | null,
  raw: Record<string, unknown> | undefined,
  wrap: (row: Record<string, unknown>) => T,
): boolean {
  let heldIndex = resolvedId ? store.findIndex((row) => row.id === resolvedId) : -1;

  // Identity fallback for an unresolved echo: the payload is keyed by the
  // database UUID, and a row held under the app id that produced it is the
  // SAME row even when this session never registered the binding (rows that
  // arrived through the `storage` event used to bind nothing — see
  // `hydrateIdentities`). Without this the echo is adopted as an unknown
  // record: the twin that shows a product twice and trips the
  // duplicate-barcode guard against the product's own barcode.
  if (heldIndex === -1 && !resolvedId && raw && typeof raw.id === 'string' && raw.id) {
    heldIndex = store.findIndex((row) => row.id && toUuid(row.id) === raw.id);
  }

  if (eventType === 'DELETE') {
    // A DELETE payload carries only `old` (the id) — there is no `new` row,
    // so this branch must not require one.
    if (heldIndex === -1) return false;
    store.splice(heldIndex, 1);
    return true;
  }

  if (!raw) return false;

  if (heldIndex !== -1) {
    if (eventType !== 'UPDATE') return false;
    const existing = store[heldIndex];
    // Keep the held row's own id. When the row was matched through the
    // identity fallback, `resolvedId` is null — passing it would blank the id.
    const next = wrap({ ...existing, ...raw, id: existing.id }) as Record<string, unknown>;
    for (const key of Object.keys(existing)) {
      if (!(key in next)) next[key] = (existing as Record<string, unknown>)[key];
    }
    store[heldIndex] = next as T;
    return true;
  }

  if (eventType !== 'INSERT' && eventType !== 'UPDATE') return false;
  const adopted = wrap(raw);
  if (!adopted.id || store.some((row) => row.id === adopted.id)) return false;
  // Claim the row so later events for it resolve to this row instead of
  // arriving as an unknown id a second time.
  bindMirrorId(adopted.id);
  store.push(adopted);
  return true;
}
