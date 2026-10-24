import React, { useState } from 'react';
import {
  BookOpen,
  Download,
  Printer,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
} from 'lucide-react';
import { db } from '../lib/supabaseClient';
import { canViewStockBook, canGenerateStockBookReports } from '../lib/permissions';
import { formatGHS } from '../lib/money';
import { buildTablePdf, downloadPdf, printReport, type PdfReportOptions } from '../lib/pdf';
import { addDays, dayKey, estimateStockDays } from '../lib/stockBook';
import { Product, Tenant } from '../types';

interface StockBookViewProps {
  currentTenant: Tenant;
  products: Product[];
}

type RangePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';

const PRESET_LABELS: Array<{ id: RangePreset; label: string }> = [
  { id: 'today', label: 'Daily (Today)' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'custom', label: 'Custom' },
];

function presetRange(preset: RangePreset, now = new Date()): { from: string; to: string } {
  const today = dayKey(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'this_week': {
      const dow = (now.getDay() + 6) % 7; // Monday-start week
      return { from: addDays(today, -dow), to: today };
    }
    case 'this_month': {
      const first = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
      return { from: first, to: today };
    }
    default:
      return { from: addDays(today, -29), to: today };
  }
}

/**
 * Stock Book — daily opening / received / total / sales / closing / value,
 * generated strictly from the inventory movement ledger. Combined report and
 * individual product sheets, with PDF download and printing.
 */
export const StockBookView: React.FC<StockBookViewProps> = ({ currentTenant, products }) => {
  const tenantId = currentTenant.id;
  const currentUser = db.getCurrentUser();
  const authorized = canViewStockBook(currentUser, tenantId);
  const canReport = canGenerateStockBookReports(currentUser, tenantId);

  const [preset, setPreset] = useState<RangePreset>('today');
  const initial = presetRange('today');
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [categoryId, setCategoryId] = useState('all');
  const [productId, setProductId] = useState('all');
  const [view, setView] = useState<'combined' | 'sheets'>('combined');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reportError, setReportError] = useState<string | null>(null);

  const categories = db.getCategories(tenantId);

  const applyPreset = (p: RangePreset) => {
    setPreset(p);
    if (p !== 'custom') {
      const r = presetRange(p);
      setFromDate(r.from);
      setToDate(r.to);
    }
  };

  const result = authorized
    ? db.getStockBook(tenantId, {
        from: fromDate,
        to: toDate,
        categoryId: categoryId === 'all' ? undefined : categoryId,
        productId: productId === 'all' ? undefined : productId,
      })
    : { success: false, message: 'Stock book access is restricted to the shop owner or authorized stock manager.' };

  if (!authorized || !result.success || !result.data) {
    return (
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 text-rose-600">
          <AlertTriangle className="w-5 h-5" />
          <p className="font-bold text-sm">
            {result.message || 'Stock book access is restricted to the shop owner or authorized stock manager.'}
          </p>
        </div>
      </div>
    );
  }

  const data = result.data;
  const movements = db.getInventoryMovements(tenantId);
  const currency = currentTenant.currency || 'GHS';

  // Potential retail value (labelled separately from cost value)
  const potentialRetailValue = data.entries.reduce(
    (sum, e) => sum + e.currentStock * (e.product.selling_price || 0),
    0
  );
  const totalUnits = data.entries.reduce((sum, e) => sum + e.currentStock, 0);

  const stockDaysFor = (entryProduct: Product) => {
    const productMovements = movements.filter((m) => m.product_id === entryProduct.id);
    return estimateStockDays(entryProduct, productMovements);
  };

  const stockDaysLabel = (entryProduct: Product) => {
    const est = stockDaysFor(entryProduct);
    if (!est.available) {
      return { text: est.message || 'No sales history', className: 'text-slate-400' };
    }
    return {
      text: `${est.days} days${est.preliminary ? ' (preliminary)' : ''}`,
      className: est.days !== null && est.days < 7 ? 'text-rose-600 font-bold' : 'text-slate-700 font-semibold',
    };
  };

  const periodLabel = `${fromDate} to ${toDate}`;

  const buildReportOptions = (): PdfReportOptions => {
    const metadata = [
      `Shop: ${currentTenant.name}`,
      `Reporting period: ${periodLabel} (${view === 'combined' ? 'Combined stock book' : 'Individual product sheets'})`,
      `Generated: ${new Date().toLocaleString()}`,
      `Currency: ${currency} — values shown at weighted-average cost`,
    ];

    if (view === 'combined') {
      const columns = [
        { header: 'Date', width: 0.11 },
        { header: 'Product', width: 0.19 },
        { header: 'Opening', width: 0.085, align: 'right' as const },
        { header: 'Received', width: 0.085, align: 'right' as const },
        { header: 'Total', width: 0.075, align: 'right' as const },
        { header: 'Sales', width: 0.075, align: 'right' as const },
        { header: 'Returns', width: 0.075, align: 'right' as const },
        { header: 'Other Out', width: 0.08, align: 'right' as const },
        { header: 'Adjust.', width: 0.08, align: 'right' as const },
        { header: 'Closing', width: 0.075, align: 'right' as const },
        { header: `Value (${currency})`, width: 0.1, align: 'right' as const },
      ];
      const rows: string[][] = [];
      let lastCategory = '';
      for (const entry of data.entries) {
        const catLabel = entry.category?.name || 'Uncategorised';
        if (catLabel !== lastCategory) {
          rows.push([`CATEGORY: ${catLabel}`, '', '', '', '', '', '', '', '', '', '']);
          lastCategory = catLabel;
        }
        for (const day of entry.days) {
          rows.push([
            day.date,
            entry.product.name,
            String(day.opening),
            String(day.received),
            String(day.total),
            String(day.sold),
            String(day.returned),
            String(day.otherOut),
            String(day.adjustments),
            String(day.closing),
            formatGHS(day.valueAtCost).replace('GH₵ ', ''),
          ]);
        }
      }
      return {
        title: `Stock Book — ${currentTenant.name}`,
        metadata,
        columns,
        rows,
        footer:
          'Closing stock valued at weighted-average purchase cost. Closing balances reconcile with the stock movement ledger.',
      };
    }

    // Individual product sheets
    const columns = [
      { header: 'Date', width: 0.12 },
      { header: 'Opening', width: 0.1, align: 'right' as const },
      { header: 'Received', width: 0.1, align: 'right' as const },
      { header: 'Sales', width: 0.09, align: 'right' as const },
      { header: 'Returns', width: 0.09, align: 'right' as const },
      { header: 'Other Out', width: 0.1, align: 'right' as const },
      { header: 'Adjust.', width: 0.1, align: 'right' as const },
      { header: 'Closing', width: 0.1, align: 'right' as const },
      { header: `Cost (${currency})`, width: 0.1, align: 'right' as const },
      { header: `Value (${currency})`, width: 0.1, align: 'right' as const },
    ];
    const rows: string[][] = [];
    for (const entry of data.entries) {
      rows.push([
        `PRODUCT: ${entry.product.name} — SKU ${entry.product.sku || '—'} | Barcode ${entry.product.barcode} | Unit cost ${formatGHS(
          entry.unitCost
        )} | Selling price ${formatGHS(entry.product.selling_price)} | Closing stock ${entry.currentStock} ${entry.product.unit}(s)`,
        '', '', '', '', '', '', '', '', '',
      ]);
      for (const day of entry.days) {
        rows.push([
          day.date,
          String(day.opening),
          String(day.received),
          String(day.sold),
          String(day.returned),
          String(day.otherOut),
          String(day.adjustments),
          String(day.closing),
          formatGHS(entry.unitCost).replace('GH₵ ', ''),
          formatGHS(day.valueAtCost).replace('GH₵ ', ''),
        ]);
      }
    }
    return {
      title: `Individual Product Stock Sheets — ${currentTenant.name}`,
      metadata,
      columns,
      rows,
      footer: 'Purchase and selling prices are confidential — owner / authorized stock manager use only.',
    };
  };

  const handleDownloadPdf = () => {
    setReportError(null);
    try {
      const options = buildReportOptions();
      if (options.rows.length === 0) {
        setReportError('No stock movement rows in the selected period — nothing to export.');
        return;
      }
      const bytes = buildTablePdf(options);
      downloadPdf(bytes, `${currentTenant.slug || 'shop'}-stock-book-${fromDate}-to-${toDate}`);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'PDF generation failed.');
    }
  };

  const handlePrint = () => {
    setReportError(null);
    const options = buildReportOptions();
    if (options.rows.length === 0) {
      setReportError('No stock movement rows in the selected period — nothing to print.');
      return;
    }
    printReport(options);
  };

  return (
    <div className="space-y-6">
      {/* Filters & actions */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-bold text-slate-500 mb-1.5">Reporting Period</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_LABELS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${
                    preset === p.id
                      ? 'bg-[#102A4C] text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4 text-xs">
          <div>
            <label className="block font-bold mb-1 text-slate-500">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPreset('custom');
              }}
              className="w-full p-2 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-800 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-bold mb-1 text-slate-500">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPreset('custom');
              }}
              className="w-full p-2 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-800 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-bold mb-1 text-slate-500">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-800 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parent_id ? `↳ ${c.name}` : c.name}
                  {!c.is_active ? ' (deactivated)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold mb-1 text-slate-500">Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-800 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            >
              <option value="all">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1 flex gap-2">
            {canReport && (
              <>
                <button
                  onClick={handleDownloadPdf}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#F28C28] hover:bg-orange-600 text-white text-xs font-bold shadow-md shadow-orange-500/20 transition"
                >
                  <Download className="w-4 h-4" />
                  <span>PDF</span>
                </button>
                <button
                  onClick={handlePrint}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#102A4C] hover:bg-slate-800 text-white text-xs font-bold transition"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* View mode */}
        <div className="flex items-center gap-2 mt-4">
          <span className="text-xs font-bold text-slate-500">Report layout:</span>
          <button
            onClick={() => setView('combined')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${
              view === 'combined' ? 'bg-orange-100 text-orange-700 border border-orange-300' : 'bg-slate-100 text-slate-600'
            }`}
          >
            Combined Stock Book
          </button>
          <button
            onClick={() => setView('sheets')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${
              view === 'sheets' ? 'bg-orange-100 text-orange-700 border border-orange-300' : 'bg-slate-100 text-slate-600'
            }`}
          >
            Individual Product Sheets
          </button>
        </div>

        {reportError && (
          <p className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-rose-600">
            <AlertTriangle className="w-3.5 h-3.5" />
            {reportError}
          </p>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-bold text-slate-500">Products in Report</span>
          <p className="text-2xl font-black text-slate-900 mt-1">{data.entries.length}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-bold text-slate-500">Closing Stock Units</span>
          <p className="text-2xl font-black text-slate-900 mt-1">{totalUnits}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 shadow-sm">
          <span className="text-xs font-bold text-emerald-800">Closing Stock Value at Cost</span>
          <p className="text-2xl font-black text-emerald-700 mt-1">{formatGHS(data.totalValueAtCost)}</p>
          <p className="text-[10px] text-emerald-700 mt-0.5">Weighted-average purchase cost</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-bold text-slate-500">Potential Sales Value (selling price)</span>
          <p className="text-2xl font-black text-slate-700 mt-1">{formatGHS(potentialRetailValue)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Labelled separately — not used for valuation</p>
        </div>
      </div>

      {/* Report body */}
      {view === 'combined' ? (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-5 h-5 text-[#F28C28]" />
            <h3 className="text-lg font-black text-slate-900">Combined Stock Book</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            {currentTenant.name} &bull; {periodLabel} &bull; one row per product per business day,
            grouped by your shop categories
          </p>

          {data.entries.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              No products match the selected filters.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                    <th className="pb-2 pr-2"></th>
                    <th className="pb-2">Product</th>
                    <th className="pb-2">Date</th>
                    <th className="pb-2 text-right">Opening</th>
                    <th className="pb-2 text-right">Received</th>
                    <th className="pb-2 text-right">Total</th>
                    <th className="pb-2 text-right">Sales</th>
                    <th className="pb-2 text-right">Returns</th>
                    <th className="pb-2 text-right">Other Out</th>
                    <th className="pb-2 text-right">Adjust.</th>
                    <th className="pb-2 text-right">Closing</th>
                    <th className="pb-2 text-right">Value ({currency})</th>
                    <th className="pb-2 text-right">Stock Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.entries.map((entry) => {
                    const isOpen = expanded[entry.product.id];
                    const est = stockDaysLabel(entry.product);
                    return (
                      <React.Fragment key={entry.product.id}>
                        <tr className="hover:bg-slate-50/70 bg-slate-50/40">
                          <td className="py-2.5 pr-2">
                            <button
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [entry.product.id]: !isOpen }))
                              }
                              className="text-slate-400 hover:text-slate-700"
                              aria-label={`Toggle ${entry.product.name} daily rows`}
                            >
                              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="py-2.5 font-bold text-slate-900">
                            {entry.product.name}
                            <span className="ml-2 text-[10px] font-semibold text-slate-400">
                              {entry.category?.name || 'Uncategorised'}
                            </span>
                            {entry.reconciles === true && (
                              <CheckCircle2 className="w-3.5 h-3.5 inline ml-1.5 text-emerald-500" />
                            )}
                            {entry.reconciles === false && (
                              <AlertTriangle className="w-3.5 h-3.5 inline ml-1.5 text-amber-500" />
                            )}
                          </td>
                          <td className="py-2.5 text-slate-500" colSpan={2}>
                            {entry.historyNote ? (
                              <span className="text-amber-600 font-semibold flex items-center gap-1">
                                <History className="w-3.5 h-3.5" />
                                {entry.historyNote}
                              </span>
                            ) : (
                              `${entry.days.length} day(s)`
                            )}
                          </td>
                          <td className="py-2.5 text-right font-black text-slate-900">
                            {entry.currentStock}
                          </td>
                          <td className="py-2.5 text-right font-semibold text-slate-800">
                            {formatGHS(entry.currentValueAtCost)}
                          </td>
                          <td className={`py-2.5 text-right ${est.className}`} colSpan={2}>
                            {est.text}
                          </td>
                        </tr>
                        {isOpen &&
                          entry.days.map((day) => (
                            <tr key={`${entry.product.id}-${day.date}`} className="hover:bg-orange-50/30">
                              <td className="py-1.5"></td>
                              <td className="py-1.5 text-slate-400 pl-4">{entry.product.name}</td>
                              <td className="py-1.5 font-mono text-slate-600">{day.date}</td>
                              <td className="py-1.5 text-right text-slate-700">{day.opening}</td>
                              <td className="py-1.5 text-right text-emerald-700 font-semibold">{day.received}</td>
                              <td className="py-1.5 text-right text-slate-700 font-semibold">{day.total}</td>
                              <td className="py-1.5 text-right text-blue-700 font-semibold">{day.sold}</td>
                              <td className="py-1.5 text-right text-amber-700">{day.returned}</td>
                              <td className="py-1.5 text-right text-rose-700">{day.otherOut}</td>
                              <td className="py-1.5 text-right text-slate-700">
                                {day.adjustments !== 0 ? day.adjustments : '—'}
                              </td>
                              <td className="py-1.5 text-right font-black text-slate-900">{day.closing}</td>
                              <td className="py-1.5 text-right text-slate-800 font-semibold">
                                {formatGHS(day.valueAtCost)}
                              </td>
                              <td className="py-1.5"></td>
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-slate-400 mt-3">
            Closing balances are computed from the stock movement ledger and reconcile with live
            inventory (green check) — no quantities are manually entered.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {data.entries.length === 0 ? (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-xs text-slate-500 text-center py-6">
                No products match the selected filters.
              </p>
            </div>
          ) : (
            data.entries.map((entry) => {
              const est = stockDaysFor(entry.product);
              return (
                <div
                  key={entry.product.id}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 mb-3">
                    <div>
                      <h4 className="text-base font-black text-slate-900">{entry.product.name}</h4>
                      <p className="text-[11px] text-slate-500 font-semibold">
                        SKU: {entry.product.sku || '—'} &bull; Barcode: {entry.product.barcode} &bull;
                        Category: {entry.category?.name || 'Uncategorised'}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="text-slate-500">
                        Unit cost (WAC):{' '}
                        <span className="font-black text-slate-900">{formatGHS(entry.unitCost)}</span>
                      </p>
                      <p className="text-slate-500">
                        Selling price:{' '}
                        <span className="font-black text-slate-900">
                          {formatGHS(entry.product.selling_price)}
                        </span>
                      </p>
                      <p className="text-emerald-700 font-black">
                        Closing value at cost: {formatGHS(entry.currentValueAtCost)}
                      </p>
                      <p className={stockDaysLabel(entry.product).className}>
                        Est. stock remaining: {stockDaysLabel(entry.product).text}
                      </p>
                      {!est.available && est.message && (
                        <p className="text-[10px] text-slate-400">{est.message}</p>
                      )}
                    </div>
                  </div>

                  {entry.historyNote ? (
                    <p className="text-[11px] text-amber-600 font-semibold flex items-center gap-1.5 mb-2">
                      <History className="w-4 h-4" />
                      {entry.historyNote}
                    </p>
                  ) : null}

                  {entry.days.length === 0 ? (
                    <p className="text-xs text-slate-500">No recorded movement days in this period.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                            <th className="pb-2">Date</th>
                            <th className="pb-2 text-right">Opening</th>
                            <th className="pb-2 text-right">Received</th>
                            <th className="pb-2 text-right">Total</th>
                            <th className="pb-2 text-right">Sold</th>
                            <th className="pb-2 text-right">Returns</th>
                            <th className="pb-2 text-right">Other Out</th>
                            <th className="pb-2 text-right">Adjust.</th>
                            <th className="pb-2 text-right">Closing</th>
                            <th className="pb-2 text-right">Value ({currency})</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {entry.days.map((day) => (
                            <tr key={day.date} className="hover:bg-slate-50/70">
                              <td className="py-2 font-mono text-slate-600">{day.date}</td>
                              <td className="py-2 text-right text-slate-700">{day.opening}</td>
                              <td className="py-2 text-right text-emerald-700 font-semibold">{day.received}</td>
                              <td className="py-2 text-right text-slate-700 font-semibold">{day.total}</td>
                              <td className="py-2 text-right text-blue-700 font-semibold">{day.sold}</td>
                              <td className="py-2 text-right text-amber-700">{day.returned}</td>
                              <td className="py-2 text-right text-rose-700">{day.otherOut}</td>
                              <td className="py-2 text-right text-slate-700">
                                {day.adjustments !== 0 ? day.adjustments : '—'}
                              </td>
                              <td className="py-2 text-right font-black text-slate-900">{day.closing}</td>
                              <td className="py-2 text-right font-semibold text-slate-800">
                                {formatGHS(day.valueAtCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Movement breakdown legend */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <h4 className="text-xs font-bold text-slate-700 mb-2">Movement Breakdown Columns</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[10px] text-slate-500">
          <span>
            <strong className="text-emerald-700">Received:</strong> opening stock, supplier
            receipts, transfers in
          </span>
          <span>
            <strong className="text-blue-700">Sales:</strong> POS checkouts
          </span>
          <span>
            <strong className="text-amber-700">Returns:</strong> customer returns / refunds back
            into stock
          </span>
          <span>
            <strong className="text-rose-700">Other Out:</strong> damage, expiry, supplier returns
          </span>
          <span>
            <strong className="text-slate-700">Adjust.:</strong> signed stock-count corrections and
            reversals
          </span>
          <span>
            <strong className="text-slate-700">Value:</strong> closing stock &times; weighted-average
            cost
          </span>
        </div>
      </div>
    </div>
  );
};
