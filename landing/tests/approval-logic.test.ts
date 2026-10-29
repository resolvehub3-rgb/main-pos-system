/**
 * Account approval logic tests — pure helpers only (no network, no database).
 *
 * These exercise the state machine the account screen runs on: a raw stored
 * approval_status is mapped to a status, then to the view the customer sees
 * (waiting / approved / rejected / unknown). The Supabase calls around them
 * are thin wrappers over the SECURITY DEFINER RPCs in
 * db/migrations/0002_account_approval.sql.
 */

import {assert, assertEqual, test} from './harness.ts';
import {
  approvalView,
  canRequestSetup,
  toApprovalStatus,
} from '../src/lib/accountStatus.ts';

test('approval: only known statuses are accepted; anything else is unknown', () => {
  assertEqual(toApprovalStatus('pending'), 'pending');
  assertEqual(toApprovalStatus('approved'), 'approved');
  assertEqual(toApprovalStatus('rejected'), 'rejected');
  assertEqual(toApprovalStatus('APPROVED'), 'unknown', 'case must match exactly');
  assertEqual(toApprovalStatus('yes'), 'unknown');
  assertEqual(toApprovalStatus(''), 'unknown');
  assertEqual(toApprovalStatus(null), 'unknown');
  assertEqual(toApprovalStatus(undefined), 'unknown');
  assertEqual(toApprovalStatus(42), 'unknown');
});

test('approval: the view state machine maps each status honestly', () => {
  assertEqual(approvalView(null), 'loading', 'null means still fetching');
  assertEqual(approvalView('pending'), 'waiting');
  assertEqual(approvalView('approved'), 'approved');
  assertEqual(approvalView('rejected'), 'rejected');
  assertEqual(approvalView('unknown'), 'unknown');
});

test('approval: only an approved account can reach the dashboard / request setup', () => {
  assertEqual(canRequestSetup('approved'), true);
  assertEqual(canRequestSetup('pending'), false, 'a pending account is locked');
  assertEqual(canRequestSetup('rejected'), false, 'a rejected account is locked');
  assertEqual(canRequestSetup('unknown'), false, 'an unknown status is locked, never assumed approved');
});

test('approval: a brand-new account defaults to pending (waiting), never approved', () => {
  // Mirrors the column default in 0002: approval_status default 'pending'.
  const storedDefault = 'pending';
  assertEqual(approvalView(toApprovalStatus(storedDefault)), 'waiting');
  assertEqual(canRequestSetup(toApprovalStatus(storedDefault)), false);
});
