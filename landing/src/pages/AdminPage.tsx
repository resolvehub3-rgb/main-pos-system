import {useCallback, useEffect, useState} from 'react';
import AccountShell from '../components/account/AccountShell';
import GateNotice from '../components/account/GateNotice';
import StatusBanner, {type BannerTone} from '../components/account/StatusBanner';
import {COMMERCE} from '../config/commerce';
import {accountAvailability} from '../lib/availability';
import {
  approveAccount,
  fetchAdminAccounts,
  fetchIsAdmin,
  rejectAccount,
  type AdminAccountRow,
  type ApprovalStatus,
} from '../lib/accountStatus';
import {getCommerceAuth, readCommerceEnv} from '../lib/commerceClient';
import {useAccountSession} from '../lib/useAccountSession';

/**
 * Super-admin approval dashboard.
 *
 * Reachable at #/admin. It lists customer accounts (newest first) so a
 * super-admin can approve or reject them. Every action calls a SECURITY
 * DEFINER RPC that re-checks is_admin() server-side — this screen is only a
 * convenience, never the security boundary. Approving fires the customer
 * notification email (db/migrations/0002_account_approval.sql).
 *
 * The list refreshes in realtime: when any profile's approval_status changes,
 * the affected row updates live.
 */

const FILTERS: Array<{label: string; value: Exclude<ApprovalStatus, 'unknown'> | null}> = [
  {label: 'All', value: null},
  {label: 'Pending', value: 'pending'},
  {label: 'Approved', value: 'approved'},
  {label: 'Rejected', value: 'rejected'},
];

function statusBadge(status: ApprovalStatus) {
  switch (status) {
    case 'approved':
      return {label: 'Approved', classes: 'bg-emerald-100 text-emerald-800'};
    case 'rejected':
      return {label: 'Rejected', classes: 'bg-red-100 text-red-800'};
    case 'pending':
      return {label: 'Pending', classes: 'bg-amber-100 text-amber-800'};
    default:
      return {label: 'Unknown', classes: 'bg-slate-200 text-slate-700'};
  }
}

export default function AdminPage() {
  const availability = accountAvailability(COMMERCE, readCommerceEnv());
  const {loading, account, signOut} = useAccountSession();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<AdminAccountRow[]>([]);
  const [filter, setFilter] = useState<Exclude<ApprovalStatus, 'unknown'> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{tone: BannerTone; message: string} | null>(null);

  const client = getCommerceAuth();
  const userId = account?.userId ?? '';

  const load = useCallback(async () => {
    if (!client) return;
    const result = await fetchAdminAccounts(client, filter ?? undefined);
    if (result.ok) {
      setAccounts(result.accounts);
      setListError(null);
    } else {
      setListError(result.message);
    }
  }, [client, filter]);

  // Confirm admin rights, then load the list.
  useEffect(() => {
    if (!client || !userId) {
      setIsAdmin(null);
      return;
    }
    let active = true;
    void fetchIsAdmin(client).then((value) => {
      if (!active) return;
      setIsAdmin(value);
      if (value) void load();
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, userId]);

  async function handleApprove(row: AdminAccountRow) {
    if (!client) return;
    setBusyId(row.id);
    const result = await approveAccount(client, row.id);
    setBusyId(null);
    if (result.ok) {
      setBanner({tone: 'success', message: `Approved ${row.email}. They have been emailed.`});
      await load();
    } else {
      setBanner({tone: 'error', message: result.message});
    }
  }

  async function handleReject(row: AdminAccountRow) {
    if (!client) return;
    const reason = window.prompt(`Reject ${row.email}? Enter an optional reason:`, '');
    if (reason === null) return; // cancelled
    setBusyId(row.id);
    const result = await rejectAccount(client, row.id, reason);
    setBusyId(null);
    if (result.ok) {
      setBanner({tone: 'info', message: `Rejected ${row.email}.`});
      await load();
    } else {
      setBanner({tone: 'error', message: result.message});
    }
  }

  if (!availability.available) {
    return (
      <AccountShell title="Admin" subtitle="Account approvals">
        <GateNotice notice={availability.notice} actionHref="#/" actionLabel="Back to the website" />
      </AccountShell>
    );
  }

  if (loading || isAdmin === null) {
    return (
      <AccountShell title="Admin" subtitle="Account approvals">
        <p className="text-sm text-navy-700">Checking access…</p>
      </AccountShell>
    );
  }

  if (!account) {
    return (
      <AccountShell title="Admin" subtitle="Account approvals">
        <GateNotice notice="Sign in with an admin account to open this page." actionHref="#/login" actionLabel="Sign in" />
      </AccountShell>
    );
  }

  if (!isAdmin) {
    return (
      <AccountShell title="Admin" subtitle="Account approvals">
        <GateNotice
          notice="This account does not have admin access. If you should, ask a super-admin to grant it."
          actionHref="#/account"
          actionLabel="Back to my account"
        />
      </AccountShell>
    );
  }

  const pendingCount = accounts.filter((row) => row.approvalStatus === 'pending').length;

  return (
    <AccountShell
      title="Account approvals"
      subtitle="Review and approve or reject customer registrations."
      footer={
        <div className="flex items-center gap-4">
          <a href="#/account" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
            My account
          </a>
          <button
            type="button"
            onClick={() => void load()}
            className="font-semibold text-amber-700 underline-offset-4 hover:underline"
          >
            Refresh
          </button>
        </div>
      }
    >
      {banner && <StatusBanner tone={banner.tone}>{banner.message}</StatusBanner>}

      <p className="mt-2 text-sm text-navy-700">
        {pendingCount === 0
          ? 'No accounts are waiting for approval.'
          : `${pendingCount} account${pendingCount === 1 ? '' : 's'} waiting for approval.`}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => setFilter(option.value)}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
              filter === option.value
                ? 'bg-amber-700 text-white'
                : 'bg-slate-100 text-navy-700 hover:bg-slate-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {listError && (
        <div className="mt-4">
          <StatusBanner tone="error">{listError}</StatusBanner>
        </div>
      )}

      <ul className="mt-5 space-y-3">
        {accounts.map((row) => {
          const badge = statusBadge(row.approvalStatus);
          return (
            <li key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-navy-900">{row.fullName || '—'}</p>
                  <p className="text-sm text-navy-700">{row.email}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Registered {new Date(row.createdAt).toLocaleDateString('en-GH', {day: 'numeric', month: 'long', year: 'numeric'})}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${badge.classes}`}
                >
                  {badge.label}
                </span>
              </div>

              {row.approvalStatus === 'rejected' && row.rejectionReason && (
                <p className="mt-2 text-xs text-red-700">Reason: {row.rejectionReason}</p>
              )}

              {row.approvalStatus === 'pending' && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleApprove(row)}
                    disabled={busyId === row.id}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {busyId === row.id ? 'Working…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReject(row)}
                    disabled={busyId === row.id}
                    className="rounded-full border border-slate-300 px-4 py-2 text-xs font-bold text-navy-700 transition-colors hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {!listError && accounts.length === 0 && (
          <li className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Nothing to show for this filter.
          </li>
        )}
      </ul>

      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-6 w-full rounded-full border border-slate-300 px-6 py-3 text-sm font-bold text-navy-800 transition-colors hover:border-navy-400 hover:bg-slate-50"
      >
        Sign out
      </button>
    </AccountShell>
  );
}
