import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, Printer, X } from 'lucide-react';
import { formatGHS } from '../lib/money';
import { Sale, Tenant } from '../types';

/**
 * Post-payment receipt printing animation (UI only).
 *
 * Shows a front-view thermal printer with a receipt feeding out of its outlet.
 * Fully automatic: once the paper has fed out the receipt is sent to the printer
 * and the modal dismisses itself — the cashier never has to click anything.
 * Printing is delegated to the caller via `onPrint`, so the app's existing
 * receipt preview and print handler are used unchanged.
 */
interface ReceiptPrinterModalProps {
  sale: Sale;
  tenant: Tenant;
  paperSize: '58mm' | '80mm';
  /** Sends the receipt to the printer once the paper has finished feeding. */
  onPrint: () => void;
  /** Dismisses the animation once printing is done. */
  onClose: () => void;
}

/** How many line items are printed on the animated paper (keeps the modal compact). */
const MAX_PRINTED_ITEMS = 8;
/** How long the receipt takes to feed out (matches the CSS animation duration). */
const FEED_DURATION_MS = 2100;
/** Pause on "Receipt Ready!" before handing the receipt to the printer. */
const PRINT_DELAY_MS = 500;
/** Grace after firing the print, so the animation is still up while printing. */
const DISMISS_DELAY_MS = 900;

export const ReceiptPrinterModal: React.FC<ReceiptPrinterModalProps> = ({
  sale,
  tenant,
  paperSize,
  onPrint,
  onClose,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [paperHeight, setPaperHeight] = useState(0);
  const [ready, setReady] = useState(false);

  // Keep the latest callbacks without re-arming the automatic sequence.
  const onPrintRef = useRef(onPrint);
  const onCloseRef = useRef(onClose);
  onPrintRef.current = onPrint;
  onCloseRef.current = onClose;

  const paperWidth = paperSize === '58mm' ? 172 : 198;
  const storeName = (tenant.name || 'SamTill').toUpperCase();
  const items = sale.items ?? [];
  const printedItems = items.slice(0, MAX_PRINTED_ITEMS);
  const hiddenItems = items.length - printedItems.length;

  const amountPaid = sale.payment_details?.cash_tendered ?? sale.total_amount;
  const changeDue = sale.payment_details?.change_due ?? 0;
  const hasChange = Boolean(sale.payment_details?.cash_tendered);

  // Measure the printed receipt so the paper clip animates to its exact height.
  useLayoutEffect(() => {
    if (contentRef.current) {
      setPaperHeight(contentRef.current.offsetHeight);
    }
  }, [sale.id, paperWidth, printedItems.length]);

  // Flip the status to "Receipt Ready!" once the paper has finished feeding.
  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const timer = window.setTimeout(() => setReady(true), reduced ? 500 : FEED_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Fully automatic: once the paper has fed out, hand the receipt to the printer,
  // then dismiss the animation so nothing stacks on the cashier's screen.
  useEffect(() => {
    if (!ready) return;
    const printTimer = window.setTimeout(() => onPrintRef.current(), PRINT_DELAY_MS);
    const dismissTimer = window.setTimeout(
      () => onCloseRef.current(),
      PRINT_DELAY_MS + DISMISS_DELAY_MS
    );
    return () => {
      window.clearTimeout(printTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [ready]);

  // Deterministic decorative barcode derived from the real invoice number.
  const barcodeBars = Array.from({ length: 38 }, (_, i) => {
    const code = (sale.invoice_number || '000000').charCodeAt(i % (sale.invoice_number?.length || 1));
    return ((code + i * 5) % 3) + 1;
  });

  const receiptStyles: React.CSSProperties = {
    width: paperWidth,
    maxWidth: '54vw',
    fontSize: '9.5px',
    lineHeight: 1.4,
  };

  const clipStyles = {
    ...receiptStyles,
    height: paperHeight,
    ['--rpm-paper-h' as keyof React.CSSProperties]: `${paperHeight}px`,
  } as React.CSSProperties;

  return (
    <div
      className="fixed inset-0 z-[60] bg-[#0E1E38]/65 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Receipt printing"
    >
      <div className="rpm-modal relative bg-white w-full max-w-md rounded-xl border border-slate-200 shadow-2xl p-5 sm:p-6 max-h-[92vh] overflow-y-auto">
        {/* Close (manual dismiss) */}
        <button
          onClick={onClose}
          aria-label="Close receipt printing modal"
          className="absolute top-4 right-4 w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Status */}
        <div className="flex items-center gap-3 pr-8">
          <span className="rpm-check flex-shrink-0">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <h3 className="text-lg sm:text-xl font-black text-[#102A4C] tracking-tight leading-tight">
              Payment Successful!
            </h3>
            <p
              aria-live="polite"
              className={`text-sm font-extrabold mt-0.5 transition-colors ${
                ready ? 'text-[#F28C28]' : 'text-slate-500 font-semibold'
              }`}
            >
              {ready ? 'Receipt Ready!' : 'Preparing your receipt...'}
            </p>
          </div>
        </div>

        {/* Printer illustration with receipt feeding out of the outlet */}
        <div className="mt-6 flex justify-center">
          <div className="relative flex flex-col items-center">
            {/* Stage: the paper grows upward from the outlet */}
            <div
              className="relative w-full flex justify-center"
              style={{ height: paperHeight }}
            >
              <div
                className={`absolute left-1/2 -translate-x-1/2 overflow-hidden ${paperHeight > 0 ? 'rpm-paper' : ''}`}
                style={{ ...clipStyles, bottom: -6 }}
              >
                {/* Thermal paper content — anchored to the top of the clip so the
                    leading edge (header) exits first and content reveals downward */}
                <div
                  ref={contentRef}
                  className="absolute top-0 inset-x-0 bg-white text-slate-800 font-mono border-t border-x border-slate-300 shadow-[0_-3px_10px_rgba(15,23,42,0.07)] px-3 pt-2.5 pb-2"
                  style={{ width: paperWidth, maxWidth: '54vw' }}
                >
                  {/* Store header */}
                  <div className="text-center">
                    <p className="font-black uppercase tracking-tight text-[11px] text-[#102A4C]">
                      {storeName}
                    </p>
                    <p className="text-[8px] text-slate-500 truncate">{tenant.address}</p>
                    <p className="text-[8px] text-slate-500">Tel: {tenant.phone}</p>
                    <p className="mt-1 font-black uppercase tracking-[0.14em] text-[8.5px] text-slate-700">
                      Supermarket Receipt
                    </p>
                  </div>

                  <div className="my-1.5 border-t border-dashed border-slate-400" />

                  {/* Receipt meta */}
                  <div className="space-y-0.5">
                    <div className="flex justify-between gap-2">
                      <span>Receipt No:</span>
                      <span className="font-bold truncate">{sale.invoice_number}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Date:</span>
                      <span className="truncate">
                        {new Date(sale.created_at).toLocaleDateString('en-GH')}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Time:</span>
                      <span>{new Date(sale.created_at).toLocaleTimeString('en-GH')}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Cashier:</span>
                      <span className="truncate">{sale.cashier_name}</span>
                    </div>
                  </div>

                  <div className="my-1.5 border-t border-dashed border-slate-400" />

                  {/* Line items */}
                  <div className="space-y-1">
                    {printedItems.map((item) => (
                      <div key={item.id} className="flex justify-between gap-2">
                        <span className="truncate">{item.product_name}</span>
                        <span className="flex-shrink-0">
                          {item.quantity} x {item.unit_price.toFixed(2)}
                        </span>
                      </div>
                    ))}
                    {hiddenItems > 0 && (
                      <div className="text-center text-[8.5px] text-slate-500">
                        + {hiddenItems} more item{hiddenItems > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>

                  <div className="my-1.5 border-t border-dashed border-slate-400" />

                  {/* Totals */}
                  <div className="space-y-0.5">
                    <div className="flex justify-between">
                      <span>Amount Paid:</span>
                      <span className="font-bold">{formatGHS(amountPaid)}</span>
                    </div>
                    {hasChange && (
                      <div className="flex justify-between">
                        <span>Change:</span>
                        <span className="font-bold">{formatGHS(changeDue)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[12px] font-black pt-1 border-t border-slate-500">
                      <span>TOTAL</span>
                      <span>{formatGHS(sale.total_amount)}</span>
                    </div>
                  </div>

                  <div className="my-1.5 border-t border-dashed border-slate-400" />

                  {/* Footer + decorative barcode */}
                  <div className="text-center">
                    <p className="font-bold text-[8.5px] text-slate-700">Thank you for shopping with us!</p>
                    <p className="text-[7.5px] text-slate-500">Goods sold are returnable within 48h.</p>
                    <div className="mt-1.5 flex items-end justify-center gap-[1.5px] h-6">
                      {barcodeBars.map((w, i) => (
                        <span
                          key={i}
                          className="bg-slate-800"
                          style={{ width: `${w}px`, height: i % 6 === 0 ? '24px' : '21px' }}
                        />
                      ))}
                    </div>
                    <p className="text-[7.5px] tracking-[0.2em] text-slate-600 mt-0.5">
                      {sale.invoice_number}
                    </p>
                    <p className="text-[7.5px] text-slate-400 mt-0.5">Powered by SamTill POS</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Front-view thermal printer */}
            <div className="relative z-10 w-[236px] sm:w-[268px]">
              {/* Outlet lip — painted over the paper base so the paper looks seated in the slot */}
              <div className="relative z-20 mx-3 h-3.5 rounded-t-md bg-[#1C3A63] border border-[#0A1A30] border-b-0 shadow-[0_6px_14px_rgba(15,23,42,0.18)]">
                <div className="absolute inset-x-4 top-[3px] h-[5px] rounded-full bg-[#050D19]" />
              </div>

              {/* Printer body */}
              <div className="relative -mt-[1px] h-[110px] rounded-b-xl rounded-t-sm bg-[#102A4C] border border-[#0A1A30] shadow-xl px-4 py-3 flex flex-col justify-between">
                <div className="absolute inset-x-5 top-[3px] h-px bg-white/10" />

                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-[#F28C28] flex items-center justify-center shadow-md shadow-orange-500/30">
                      <Printer className="w-4 h-4 text-white" strokeWidth={2.2} />
                    </div>
                    <div className="leading-none">
                      <p className="text-[9px] font-black tracking-[0.2em] text-white">SAMTECH</p>
                      <p className="text-[7.5px] font-semibold tracking-[0.16em] text-slate-400 mt-0.5">
                        THERMAL POS
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[8px] font-black uppercase tracking-wider text-emerald-400">
                      Online
                    </span>
                  </div>
                </div>

                <div className="flex items-end justify-between">
                  {/* Vent slots */}
                  <div className="flex gap-1">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <span key={i} className="w-1 h-3.5 rounded-sm bg-white/10" />
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black text-slate-400 tracking-wider">
                      {paperSize}
                    </span>
                    {/* Paper feed button */}
                    <span className="w-7 h-7 rounded-full bg-white/10 border border-white/15 shadow-inner" />
                  </div>
                </div>
              </div>

              {/* Base / feet */}
              <div className="mx-auto h-1.5 w-[88%] rounded-b-lg bg-[#0A1A30]" />
            </div>
          </div>
        </div>

        {/* No action buttons: the receipt prints and the modal dismisses itself. */}
      </div>
    </div>
  );
};
