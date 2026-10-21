import React, { useRef } from 'react';
import { Printer, X, CheckCircle2, ShoppingCart } from 'lucide-react';
import { formatGHS } from '../lib/money';
import { Sale, Tenant } from '../types';

interface ReceiptModalProps {
  sale: Sale;
  tenant: Tenant;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ sale, tenant, onClose }) => {
  const receiptRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Modal Top Bar */}
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

        {/* Printable Thermal Receipt (Formatted for 58mm / 80mm ESC/POS printers) */}
        <div className="my-4 overflow-y-auto flex-1 bg-amber-50/30 p-4 border border-dashed border-slate-300 rounded-xl font-mono text-[11px] text-slate-800">
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

        {/* Modal Bottom Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-100 transition"
          >
            Done
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 rounded-xl bg-[#F28C28] hover:bg-orange-600 text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-md shadow-orange-500/20 transition"
          >
            <Printer className="w-4 h-4" />
            <span>Print Thermal</span>
          </button>
        </div>
      </div>
    </div>
  );
};
