import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CreditCard, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import type { Tenant, UserAccount } from '../types';
import type { TenantAccessDecision } from '../lib/subscriptionGate';
import { db } from '../lib/supabaseClient';

interface SubscriptionGateProps {
  user: UserAccount;
  tenant: Tenant;
  decision: TenantAccessDecision;
  checkoutReturnReference?: string | null;
  onClearCheckoutReturn?: () => void;
  onLogout: () => void;
}

const PLAN_CODE = 'samtill-pos-6m';

function formatDisplayDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export const SubscriptionGate: React.FC<SubscriptionGateProps> = ({
  user,
  tenant,
  decision,
  checkoutReturnReference,
  onClearCheckoutReturn,
  onLogout,
}) => {
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const verifiedRef = useRef<string | null>(null);

  const apiBase = (import.meta.env?.VITE_COMMERCE_API_BASE ?? '').replace(/\/+$/, '');

  useEffect(() => {
    if (!checkoutReturnReference || verifiedRef.current === checkoutReturnReference) return;
    verifiedRef.current = checkoutReturnReference;

    let active = true;
    const verifyPayment = async () => {
      setVerifying(true);
      setError(null);
      setStatusMessage('Verifying your GH₵500.00 payment with Paystack…');

      const token = await db.getAuthAccessToken();
      if (!token) {
        if (!active) return;
        setVerifying(false);
        setError('Your login session expired. Sign in again to verify your payment.');
        return;
      }

      const delays = [0, 1500, 3000, 6000];
      let finalError = 'We could not confirm your payment yet. Click "Check payment status" to retry.';

      for (const delay of delays) {
        if (!active) return;
        if (delay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
        }
        try {
          const res = await fetch(`${apiBase}/api/verify`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ reference: checkoutReturnReference }),
            cache: 'no-store',
          });
          const body = (await res.json().catch(() => ({}))) as {
            status?: string;
            message?: string;
            error?: string;
          };

          if (res.ok && body.status === 'paid') {
            await db.refreshTenantBilling(tenant.id);
            if (!active) return;
            setVerifying(false);
            setStatusMessage('Payment verified! Your 6-Month Subscription is now active.');
            onClearCheckoutReturn?.();
            return;
          }

          finalError = body.message || finalError;
          if (res.status !== 502 && res.status !== 429) {
            break;
          }
        } catch {
          finalError = 'Could not reach the verification service. Check your connection and retry.';
        }
      }

      if (!active) return;
      setVerifying(false);
      setStatusMessage(null);
      setError(finalError);
    };

    void verifyPayment();
    return () => {
      active = false;
    };
  }, [apiBase, checkoutReturnReference, onClearCheckoutReturn, tenant.id]);

  const handlePayNow = async () => {
    setError(null);
    setStatusMessage(null);
    setPaying(true);

    try {
      const token = await db.getAuthAccessToken();
      if (!token) {
        setError('Sign in with your SamTill account to initiate payment.');
        setPaying(false);
        return;
      }

      const res = await fetch(`${apiBase}/api/checkout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planCode: PLAN_CODE, returnTo: 'pos' }),
        cache: 'no-store',
      });

      const body = (await res.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        message?: string;
        error?: string;
      };

      if (res.status === 409 && body.error === 'already_subscribed') {
        await db.refreshTenantBilling(tenant.id);
        setPaying(false);
        return;
      }

      if (!res.ok || !body.authorizationUrl) {
        setError(body.message || 'Could not start Paystack checkout right now. Please try again.');
        setPaying(false);
        return;
      }

      window.location.assign(body.authorizationUrl);
    } catch {
      setError('Could not reach the payment service. Check your internet connection.');
      setPaying(false);
    }
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    setError(null);
    await db.refreshTenantBilling(tenant.id);
    setRefreshing(false);
  };

  const statusBadge =
    decision.reason === 'expired'
      ? 'Expired'
      : decision.reason === 'suspended'
        ? 'Suspended'
        : decision.reason === 'past_due'
          ? 'Renewal Due'
          : 'Unpaid / Activation Required';

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10 bg-[#F5F7FA]">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        <div className="bg-[#102A4C] px-6 py-6 text-white sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-widest text-[#F28C28]">
              SamTill POS &bull; {tenant.name}
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-200">
              <ShieldAlert className="h-3.5 w-3.5" />
              {statusBadge}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{decision.title}</h1>
          <p className="mt-1.5 text-sm text-slate-200">{decision.message}</p>
        </div>

        <div className="p-6 sm:p-8 space-y-5">
          {decision.expiresAt && decision.reason === 'expired' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Previous subscription expired on{' '}
              <strong>{formatDisplayDate(decision.expiresAt)}</strong>.
            </div>
          )}

          {statusMessage && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <span>{statusMessage}</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              {error}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Single Subscription Package
                </p>
                <h2 className="text-base font-extrabold text-[#102A4C]">
                  SamTill POS &ndash; 6-Month Subscription
                </h2>
              </div>
              <span className="text-2xl font-extrabold text-[#102A4C]">GH₵500.00</span>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 text-xs">
              <div>
                <dt className="font-semibold text-slate-500">Duration</dt>
                <dd className="mt-0.5 font-bold text-slate-900">6 Months</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Payment Type</dt>
                <dd className="mt-0.5 font-bold text-slate-900">Single upfront payment</dd>
              </div>
            </dl>
          </div>

          {user.role === 'shop_owner' ? (
            <button
              type="button"
              onClick={() => void handlePayNow()}
              disabled={paying || verifying}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#F28C28] px-6 py-3.5 text-sm font-extrabold uppercase tracking-wide text-white shadow-md transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <CreditCard className="h-4 w-4" />
              {verifying
                ? 'Verifying Payment…'
                : paying
                  ? 'Opening Paystack Checkout…'
                  : 'PAY NOW — GH₵500.00'}
            </button>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Signed in as cashier (<strong>{user.full_name}</strong>). Please ask your shop owner
              to complete the GH₵500.00 6-Month Subscription payment to unlock the register.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-sm">
            <button
              type="button"
              onClick={() => void handleRefreshStatus()}
              disabled={refreshing || verifying}
              className="inline-flex items-center gap-1.5 font-semibold text-[#102A4C] hover:text-[#F28C28] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Checking…' : 'Check subscription status'}
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 font-semibold text-slate-600 hover:text-red-700"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
