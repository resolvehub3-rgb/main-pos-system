/**
 * Account approval status — reads, realtime subscription and admin actions.
 *
 * Same honesty rules as the rest of the commerce client:
 *  - the browser never decides approval. It only reads the approval_status the
 *    server stores on the caller's own profile row and reflects it;
 *  - the only "success" the UI ever shows for approve/reject is what the RPC
 *    actually returned — a failed call surfaces an error, never a fake success;
 *  - pure classification helpers (approvalView, canRequestSetup, …) are
 *    unit-tested with no network; the Supabase calls are thin wrappers.
 *
 * Backend: the dedicated "samtill-commerce" Supabase project (profiles +
 * SECURITY DEFINER RPCs from db/migrations/0002_account_approval.sql).
 * RLS lets a signed-in customer read only their own profile row, so the
 * realtime subscription below can only ever deliver their own approval change.
 */

import type {SupabaseClient} from '@supabase/supabase-js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'unknown';

/** What the account screen should render for a given approval status. */
export type ApprovalView = 'loading' | 'waiting' | 'approved' | 'rejected' | 'unknown';

/**
 * Map a raw stored value to an ApprovalStatus. Anything unexpected becomes
 * 'unknown' — the UI shows an honest "contact us" state rather than guessing.
 */
export function toApprovalStatus(value: unknown): ApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected'
    ? value
    : 'unknown';
}

/** Decide the account-screen state machine from an approval status. */
export function approvalView(status: ApprovalStatus | null): ApprovalView {
  if (status === null) return 'loading';
  switch (status) {
    case 'pending':
      return 'waiting';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'unknown';
  }
}

/** Only an approved account may reach the dashboard / request setup. */
export function canRequestSetup(status: ApprovalStatus): boolean {
  return status === 'approved';
}

// ---------------------------------------------------------------------------
// Read the signed-in customer's own approval status (RLS: own row only)
// ---------------------------------------------------------------------------

export type ApprovalReadResult =
  | {ok: true; status: ApprovalStatus}
  | {ok: false; kind: 'not_found' | 'network' | 'invalid_response'; message: string};

export async function fetchApprovalStatus(
  client: SupabaseClient,
  userId: string,
): Promise<ApprovalReadResult> {
  let data: {approval_status?: unknown} | null;
  let error: {message?: string} | null;
  try {
    const result = await client
      .from('profiles')
      .select('approval_status')
      .eq('id', userId)
      .maybeSingle();
    data = result.data;
    error = result.error;
  } catch {
    return {ok: false, kind: 'network', message: 'Could not reach the account service.'};
  }

  if (error) {
    return {ok: false, kind: 'network', message: 'Could not load your account status.'};
  }
  if (!data) {
    return {ok: false, kind: 'not_found', message: 'No account profile was found for this user.'};
  }
  return {ok: true, status: toApprovalStatus(data.approval_status)};
}

// ---------------------------------------------------------------------------
// Realtime: watch the caller's own approval_status and report changes live
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void;

/**
 * Subscribe to approval changes on the caller's own profile. RLS guarantees
 * the subscription can only ever deliver this user's own row, so no other
 * customer's data can leak through the channel. Returns an unsubscribe fn.
 */
export function subscribeToApproval(
  client: SupabaseClient,
  userId: string,
  onChange: (status: ApprovalStatus) => void,
): Unsubscribe {
  const channel = client
    .channel(`approval-${userId}`)
    .on(
      'postgres_changes',
      {event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}`},
      (payload) => {
        const next = (payload.new as {approval_status?: unknown} | null)?.approval_status;
        if (next !== undefined) onChange(toApprovalStatus(next));
      },
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

// ---------------------------------------------------------------------------
// Setup request (approved customers only; enforced server-side by the RPC)
// ---------------------------------------------------------------------------

export type SetupRequestResult =
  | {ok: true}
  | {ok: false; kind: 'not_approved' | 'auth_required' | 'network' | 'server'; message: string};

export async function requestSetup(
  client: SupabaseClient,
  message: string,
): Promise<SetupRequestResult> {
  let data: unknown;
  let error: {code?: string; message?: string} | null;
  try {
    const result = await client.rpc('request_setup', {p_message: message});
    data = result.data;
    error = result.error;
  } catch {
    return {ok: false, kind: 'network', message: 'Could not reach the account service.'};
  }

  if (error) {
    const message_ = error.message ?? '';
    if (error.code === '42501' || message_.includes('account_not_approved')) {
      return {
        ok: false,
        kind: 'not_approved',
        message: 'Your account has not been approved yet, so a setup request cannot be sent.',
      };
    }
    if (error.code === '42501' || message_.includes('not_authenticated')) {
      return {ok: false, kind: 'auth_required', message: 'Sign in to request setup.'};
    }
    return {ok: false, kind: 'server', message: 'Could not record your setup request.'};
  }

  return {ok: true};
}

export async function hasOpenSetupRequest(client: SupabaseClient): Promise<boolean | null> {
  try {
    const {data, error} = await client.rpc('has_open_setup_request');
    if (error) return null;
    return Boolean(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Admin actions (server re-checks is_admin() on every RPC)
// ---------------------------------------------------------------------------

export interface AdminAccountRow {
  id: string;
  email: string;
  fullName: string | null;
  approvalStatus: ApprovalStatus;
  createdAt: string;
  rejectionReason: string | null;
}

export type AdminListResult =
  | {ok: true; accounts: AdminAccountRow[]}
  | {ok: false; kind: 'not_admin' | 'network' | 'invalid_response'; message: string};

function readAdminRow(value: unknown): AdminAccountRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.email !== 'string') return null;
  if (typeof row.created_at !== 'string') return null;
  return {
    id: row.id,
    email: row.email,
    fullName: typeof row.full_name === 'string' ? row.full_name : null,
    approvalStatus: toApprovalStatus(row.approval_status),
    createdAt: row.created_at,
    rejectionReason: typeof row.rejection_reason === 'string' ? row.rejection_reason : null,
  };
}

export async function fetchAdminAccounts(
  client: SupabaseClient,
  status?: Exclude<ApprovalStatus, 'unknown'>,
): Promise<AdminListResult> {
  let data: unknown;
  let error: {code?: string; message?: string} | null;
  try {
    const query = client.rpc('admin_list_accounts', {
      p_status: status ?? null,
    });
    const result = await query;
    data = result.data;
    error = result.error;
  } catch {
    return {ok: false, kind: 'network', message: 'Could not reach the account service.'};
  }

  if (error) {
    if (error.code === '42501' || (error.message ?? '').includes('not_admin')) {
      return {ok: false, kind: 'not_admin', message: 'You do not have admin access.'};
    }
    return {ok: false, kind: 'network', message: 'Could not load accounts.'};
  }

  if (!Array.isArray(data)) {
    return {ok: false, kind: 'invalid_response', message: 'The account service returned an unexpected answer.'};
  }

  const accounts: AdminAccountRow[] = [];
  for (const entry of data) {
    const row = readAdminRow(entry);
    if (row) accounts.push(row);
  }
  return {ok: true, accounts};
}

export type AdminActionResult =
  | {ok: true; status: ApprovalStatus}
  | {ok: false; kind: 'not_admin' | 'not_found' | 'network' | 'server'; message: string};

function classifyAdminAction(error: {code?: string; message?: string} | null): AdminActionResult {
  const message = error?.message ?? '';
  if (error?.code === '42501' || message.includes('not_admin')) {
    return {ok: false, kind: 'not_admin', message: 'You do not have admin access.'};
  }
  if (error?.code === 'P0002' || message.includes('account_not_found')) {
    return {ok: false, kind: 'not_found', message: 'That account could not be found.'};
  }
  return {ok: false, kind: 'server', message: 'The action could not be completed.'};
}

export async function approveAccount(
  client: SupabaseClient,
  userId: string,
): Promise<AdminActionResult> {
  let data: unknown;
  let error: {code?: string; message?: string} | null;
  try {
    const result = await client.rpc('approve_account', {p_user_id: userId});
    data = result.data;
    error = result.error;
  } catch {
    return {ok: false, kind: 'network', message: 'Could not reach the account service.'};
  }
  if (error) return classifyAdminAction(error);
  return {ok: true, status: toApprovalStatus(data)};
}

export async function rejectAccount(
  client: SupabaseClient,
  userId: string,
  reason: string,
): Promise<AdminActionResult> {
  let data: unknown;
  let error: {code?: string; message?: string} | null;
  try {
    const result = await client.rpc('reject_account', {p_user_id: userId, p_reason: reason});
    data = result.data;
    error = result.error;
  } catch {
    return {ok: false, kind: 'network', message: 'Could not reach the account service.'};
  }
  if (error) return classifyAdminAction(error);
  return {ok: true, status: toApprovalStatus(data)};
}

/** Is the signed-in user an admin? Best-effort; false on any failure. */
export async function fetchIsAdmin(client: SupabaseClient): Promise<boolean> {
  try {
    const {data, error} = await client.rpc('am_i_admin');
    return !error && Boolean(data);
  } catch {
    return false;
  }
}
