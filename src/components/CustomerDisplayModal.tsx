import React from 'react';
import { X, ShoppingCart, Store, CheckCircle2 } from 'lucide-react';
import { formatGHS } from '../lib/money';
import { CustomerDisplayItem } from '../types';

interface CustomerDisplayModalProps {
  /** Shop name shown in the header (customer-facing only). */
  tenantName: string;
  /** Projected cart lines — see src/lib/customerDisplay.ts. */
  items: CustomerDisplayItem[];
  /** Amount due, straight from the cashier's calculateCartTotals. */
  totalAmount: number;
  onClose: () => void;
}

/**
 * The customer-facing screen.
 *
 * One component, two hosts: the in-page preview modal (browser/PWA and
 * single-monitor desktop) and the native second-monitor window
 * (`CustomerDisplayWindow`, Electron). It only ever receives the narrow
 * customer projection — never internal product or tenant data.
 */
export const CustomerDisplayModal: React.FC<CustomerDisplayModalProps> = ({
  tenantName,
  items,
  totalAmount,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-[#102A4C] text-white flex flex-col justify-between p-6 sm:p-10">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-700/80">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#F28C28] flex items-center justify-center text-white shadow-lg">
            <Store className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">{tenantName}</h1>
            <p className="text-xs text-orange-300 font-semibold">Welcome! We appreciate your business.</p>
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Close Customer Display"
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
        >
          <X className="w-6 h-6" />
        </button>
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
                <div className="flex items-center gap-4">
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-14 h-14 rounded-xl object-cover border border-slate-700"
                  />
                  <div>
                    <h3 className="text-base font-bold text-white">{item.name}</h3>
                    <p className="text-xs text-slate-400">
                      {item.quantity} x {formatGHS(item.unitPrice)}
                    </p>
                  </div>
                </div>
                <span className="text-lg font-black text-[#F28C28]">
                  {formatGHS(item.unitPrice * item.quantity)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Big Customer Total Bar */}
      <div className="max-w-4xl mx-auto w-full p-6 bg-slate-800 rounded-2xl border border-slate-700 flex items-center justify-between shadow-2xl">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Amount Due</span>
          <p className="text-3xl sm:text-4xl font-black text-white mt-1">
            {formatGHS(totalAmount)}
          </p>
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
  );
};
