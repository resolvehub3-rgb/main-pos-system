import React from 'react';
import {
  X,
  ShoppingCart,
  Store,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Tag,
} from 'lucide-react';
import {formatGHS} from '../lib/money';
import type {CustomerDisplayPayment, CustomerDisplayState} from '../types';

interface CustomerDisplayModalProps {
  /**
   * The full customer projection (see src/lib/customerDisplay.ts): shop
   * identity, cart lines, subtotal/discount/tax/amount due and the optional
   * payment confirmation. Nothing internal ever travels in this object.
   */
  state: CustomerDisplayState;
  /**
   * Dismiss handler for the close (X) button in the header.
   *
   * The button only exists where this is supplied: the in-page preview
   * modal passes it so its fallback stays dismissible, while the real
   * second-monitor customer screen (CustomerDisplayWindow) deliberately
   * omits it — customers must not be able to close that screen.
   */
  onClose?: () => void;
  /**
   * Renders the operator's one-click full-screen control (second-monitor
   * window only). Full-screen needs a gesture in that window, so the button
   * is the honest activation path — never a hidden hack.
   */
  fullscreenControl?: boolean;
  /** Whether the host window is currently full-screen (toggles the icon). */
  isFullscreen?: boolean;
  /** Toggle handler for the full-screen control. */
  onToggleFullscreen?: () => void;
  /**
   * Honest notice shown next to the full-screen control when the browser
   * refuses it (it can never be forced). Null/undefined → nothing shown.
   */
  fullscreenHint?: string | null;
  /**
   * Live link indicator for the second-monitor window: false when no state
   * has arrived from the till for a while (cashier closed / reloaded).
   */
  linkLive?: boolean;
}

const PAYMENT_LABELS: Record<CustomerDisplayPayment['method'], string> = {
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  card: 'Card',
  split: 'Split Payment',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
};

/**
 * The customer-facing screen.
 *
 * One component, two hosts: the in-page preview modal (single-monitor
 * fallback) and the second-monitor popup window (`CustomerDisplayWindow`).
 * It only ever receives the narrow customer projection — never internal
 * product or tenant data — and it is strictly read-only: there is no control
 * here that can change the sale, only display-level affordances (close on the
 * preview, full-screen on the second monitor).
 *
 * Sized for a monitor facing the customer: large figures, high contrast on
 * the SamTill navy/orange brand, line totals and the amount due readable
 * from across the counter.
 */
export const CustomerDisplayModal: React.FC<CustomerDisplayModalProps> = ({
  state,
  onClose,
  fullscreenControl,
  isFullscreen,
  onToggleFullscreen,
  fullscreenHint,
  linkLive,
}) => {
  const {tenantName, tenantLogo, items, subtotal, discountTotal, taxTotal, totalAmount, payment} = state;

  return (
    <div className="fixed inset-0 z-50 bg-[#102A4C] text-white flex flex-col justify-between p-6 sm:p-10">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-700/80">
        <div className="flex items-center gap-3">
          {tenantLogo ? (
            <img
              src={tenantLogo}
              alt=""
              className="w-12 h-12 rounded-2xl object-cover bg-[#F28C28] shadow-lg border border-orange-400/30"
            />
          ) : (
            <div className="w-12 h-12 rounded-2xl bg-[#F28C28] flex items-center justify-center text-white shadow-lg">
              <Store className="w-7 h-7" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-black tracking-tight">{tenantName}</h1>
            <p className="text-xs text-orange-300 font-semibold">Welcome! We appreciate your business.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Second-monitor link indicator (display-level, never business data) */}
          {linkLive !== undefined && (
            <span
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border ${
                linkLive
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${linkLive ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {linkLive ? 'Live' : 'Waiting for the till…'}
            </span>
          )}

          {fullscreenControl && onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
          )}
          {fullscreenHint && fullscreenControl && (
            <span className="hidden sm:inline text-[11px] text-amber-300 max-w-[16rem] text-right">
              {fullscreenHint}
            </span>
          )}

          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close Customer Display"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>
      </div>

      {/* Main Scanned Items Stream */}
      <div className="flex-1 my-6 overflow-y-auto max-w-4xl mx-auto w-full">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <ShoppingCart className="w-16 h-16 text-slate-600 mb-4 animate-bounce" />
            <h2 className="text-xl font-bold text-slate-300">Next Customer, Please</h2>
            <p className="text-sm text-slate-400 mt-1">Items will appear here as they are scanned.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 rounded-2xl bg-slate-800/80 border border-slate-700/80"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-14 h-14 rounded-xl object-cover border border-slate-700 flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-white truncate">{item.name}</h3>
                    <p className="text-xs text-slate-400">
                      {item.quantity} &times; {formatGHS(item.unitPrice)}
                    </p>
                    {item.discountPercent > 0 && (
                      <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-bold">
                        <Tag className="w-3 h-3" />
                        {item.discountPercent}% off
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-lg font-black text-[#F28C28] ml-3 whitespace-nowrap">
                  {formatGHS(item.lineTotal)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totals / payment confirmation bar */}
      {payment ? (
        <div
          role="status"
          aria-live="polite"
          className="max-w-4xl mx-auto w-full p-6 bg-emerald-600/90 rounded-2xl border border-emerald-400/40 flex items-center justify-between shadow-2xl"
        >
          <div className="flex items-center gap-4">
            <CheckCircle2 className="w-12 h-12 text-white" />
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-100">
                Payment Received — Thank You!
              </span>
              <p className="text-3xl sm:text-4xl font-black text-white mt-1">
                {formatGHS(payment.amount)}
              </p>
            </div>
          </div>
          <div className="text-right text-white">
            <p className="text-sm font-bold uppercase tracking-wide">
              {PAYMENT_LABELS[payment.method]}
              {payment.reference ? ` • ${payment.reference}` : ''}
            </p>
            {payment.changeDue !== undefined && payment.changeDue > 0 && (
              <p className="text-lg font-black mt-1">Change: {formatGHS(payment.changeDue)}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto w-full p-6 bg-slate-800 rounded-2xl border border-slate-700 flex items-center justify-between shadow-2xl">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-8 text-sm text-slate-300 font-semibold">
              <span>Subtotal</span>
              <span>{formatGHS(subtotal)}</span>
            </div>
            {discountTotal > 0 && (
              <div className="flex items-center justify-between gap-8 text-sm text-amber-300 font-bold">
                <span>Discount</span>
                <span>&minus; {formatGHS(discountTotal)}</span>
              </div>
            )}
            {taxTotal > 0 && (
              <div className="flex items-center justify-between gap-8 text-sm text-slate-300 font-semibold">
                <span>Tax</span>
                <span>{formatGHS(taxTotal)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-700 flex items-center justify-between gap-8">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Amount Due
                </span>
                <p className="text-3xl sm:text-4xl font-black text-white mt-1">{formatGHS(totalAmount)}</p>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Ready for Payment</span>
                </span>
                <p className="text-[11px] text-slate-400 mt-1">Cash • MoMo • Visa / Mastercard</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
