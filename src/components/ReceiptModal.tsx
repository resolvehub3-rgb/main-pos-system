import React, { useEffect, useRef, useState } from 'react';
import { Printer, X, CheckCircle2, ShoppingCart } from 'lucide-react';
import { formatGHS } from '../lib/money';
import { printSaleReceipt } from '../lib/printBridge';
import { Sale, Tenant } from '../types';

interface ReceiptModalProps {
  sale: Sale;
  tenant: Tenant;
  onClose: () => void;
  /**
   * Silent post-checkout print: the receipt renders off-screen, sends straight
   * to the printer and the modal closes itself — nothing is shown to the cashier.
   * Leave undefined for the reprint flow, which shows the receipt for confirmation.
   */
  autoPrint?: boolean;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ sale, tenant, onClose, autoPrint = false }) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const printedRef = useRef(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  /**
   * Set when the automatic print could not reach paper.
   *
   * The auto-print receipt renders off-screen, so an error would otherwise be
   * invisible and the cashier would assume the customer had their receipt.
   * Flipping this makes the modal render visibly — as the normal preview, with
   * the error and a retry button — instead of dismissing.
   */
  const [autoFailed, setAutoFailed] = useState(false);

  // `onClose` is often an inline arrow, so it changes identity every render.
  // Reading it from a ref keeps the print timer from being cancelled by a
  // re-render that lands inside the delay window.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /** Renders as the visible preview rather than the off-screen print copy. */
  const showAsDialog = !autoPrint || autoFailed;

  /**
   * Send the receipt to paper. Resolves true when paper was requested.
   *
   * Prefers the local print bridge (direct thermal output, no OS dialog) and
   * falls back to the browser print dialog when the bridge isn't running —
   * unless the owner pinned the path to hardware-only, in which case a failure
   * is reported rather than quietly downgraded.
   */
  const sendToPrinter = async (): Promise<boolean> => {
    if (printing) return false;
    setPrinting(true);
    setPrintError(null);
    try {
      const outcome = await printSaleReceipt(sale, tenant);
      if (outcome.path === 'browser') {
        window.print();
        return true;
      }
      if (!outcome.ok) {
        setPrintError(outcome.error);
        return false;
      }
      return true;
    } finally {
      setPrinting(false);
    }
  };

  // Automatic print: fire once the receipt is in the DOM, then dismiss.
  // Only dismiss on success — a failure has to stay on screen so the cashier
  // can reprint, instead of silently believing paper came out.
  useEffect(() => {
    if (!autoPrint || printedRef.current) return;
    printedRef.current = true;
    const timer = window.setTimeout(() => {
      void sendToPrinter().then((ok) => {
        if (ok) onCloseRef.current();
        else setAutoFailed(true);
      });
    }, 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint]);

  const handlePrint = () => {
    void sendToPrinter();
  };

  return (
    <div
      className={
        showAsDialog
          ? 'fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4'
          : 'receipt-auto-print'
      }
      role={showAsDialog ? 'dialog' : undefined}
      aria-modal={showAsDialog ? true : undefined}
      aria-hidden={showAsDialog ? undefined : true}
    >
      <div className="print-unclip bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Modal Top Bar (reprint flow, and a failed auto-print) */}
        {showAsDialog && (
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span className="font-extrabold text-sm text-slate-900">Sale Confirmed</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Receipt Modal"
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        )}

        {/* Printable Thermal Receipt (Formatted for 58mm / 80mm ESC/POS printers) */}
        <div className="print-unclip my-4 overflow-y-auto flex-1 bg-amber-50/30 p-4 border border-dashed border-slate-300 rounded-xl font-mono text-[11px] text-slate-800">
          <div ref={receiptRef} id="printable-receipt" className="space-y-2">
            {/* Store Header */}
            <div className="text-center pb-2 border-b border-dashed border-slate-400">
              <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">
                {tenant.name}
              </h2>
              <p className="text-[10px] text-slate-500">{tenant.address}</p>
              <p className="text-[10px] text-slate-500">Tel: {tenant.phone}</p>
              <p className="text-[10px] font-bold text-slate-700 mt-1">SUPERMARKET TAX INVOICE</p>
            </div>

            {/* Invoice Meta */}
            <div className="text-[10px] space-y-0.5 py-1 border-b border-dashed border-slate-300">
              <div className="flex justify-between">
                <span>Invoice:</span>
                <span className="font-bold">{sale.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span>{new Date(sale.created_at).toLocaleString('en-GH')}</span>
              </div>
              <div className="flex justify-between">
                <span>Cashier:</span>
                <span>{sale.cashier_name}</span>
              </div>
              {sale.customer_name && (
                <div className="flex justify-between">
                  <span>Customer:</span>
                  <span>{sale.customer_name}</span>
                </div>
              )}
            </div>

            {/* Line Items */}
            <div className="py-2 space-y-1.5 border-b border-dashed border-slate-400">
              <div className="flex justify-between font-bold text-[10px] text-slate-500 uppercase pb-1">
                <span>Item</span>
                <span>Qty x Price</span>
                <span>Total</span>
              </div>
              {sale.items && sale.items.map((item) => (
                <div key={item.id} className="flex justify-between items-start text-[10px]">
                  <div className="max-w-[120px] font-bold truncate">{item.product_name}</div>
                  <div className="text-slate-500">
                    {item.quantity} x {item.unit_price.toFixed(2)}
                  </div>
                  <div className="font-bold">{item.total_amount.toFixed(2)}</div>
                </div>
              ))}
            </div>

            {/* Totals Calculation */}
            <div className="py-1 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatGHS(sale.subtotal)}</span>
              </div>
              {sale.discount_amount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount:</span>
                  <span>-{formatGHS(sale.discount_amount)}</span>
                </div>
              )}
              <div className="flex justify-between font-extrabold text-sm pt-1 border-t border-slate-400">
                <span>TOTAL:</span>
                <span>{formatGHS(sale.total_amount)}</span>
              </div>
            </div>

            {/* Payment Details */}
            <div className="py-1 border-t border-dashed border-slate-300 text-[10px] space-y-0.5">
              <div className="flex justify-between font-semibold">
                <span>Payment:</span>
                <span className="capitalize">{sale.payment_method.replace('_', ' ')}</span>
              </div>
              {sale.payment_details?.cash_tendered ? (
                <>
                  <div className="flex justify-between">
                    <span>Cash Tendered:</span>
                    <span>{formatGHS(sale.payment_details.cash_tendered)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Change Due:</span>
                    <span>{formatGHS(sale.payment_details.change_due || 0)}</span>
                  </div>
                </>
              ) : null}
              {sale.payment_details?.momo_reference && (
                <div className="flex justify-between">
                  <span>MoMo Ref:</span>
                  <span className="font-bold">{sale.payment_details.momo_reference}</span>
                </div>
              )}
            </div>

            {/* Footer Notice */}
            <div className="pt-2 text-center text-[9px] text-slate-500 border-t border-dashed border-slate-400 leading-tight">
              <p className="font-bold text-slate-700">Thank you for shopping with us!</p>
              <p className="mt-0.5">Goods sold are returnable within 48h with receipt.</p>
              <p className="mt-1 font-semibold text-slate-400">Powered by Samtech Helper POS 🇬🇭</p>
            </div>
          </div>
        </div>

        {/* Modal Bottom Buttons (reprint flow, and a failed auto-print) */}
        {showAsDialog && (
        <div className="pt-2 space-y-2">
          {printError && (
            <p
              role="alert"
              className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
            >
              Thermal printer error: {printError}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-100 transition"
            >
              Done
            </button>
            <button
              onClick={handlePrint}
              disabled={printing}
              className="flex-1 py-2.5 rounded-xl bg-[#F28C28] hover:bg-orange-600 text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-md shadow-orange-500/20 transition disabled:opacity-60 disabled:cursor-wait"
            >
              <Printer className="w-4 h-4" />
              <span>{printing ? 'Printing…' : 'Print Thermal'}</span>
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
};
