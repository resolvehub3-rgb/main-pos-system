import React, { useState } from 'react';
import {
  X,
  Database,
  CheckCircle2,
  AlertCircle,
  Copy,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { db, SupabaseConfig } from '../lib/supabaseClient';

interface SupabaseConfigModalProps {
  onClose: () => void;
  config: SupabaseConfig;
  onRefresh: () => void;
}

export const SupabaseConfigModal: React.FC<SupabaseConfigModalProps> = ({
  onClose,
  config,
  onRefresh,
}) => {
  const [url, setUrl] = useState(config.url || '');
  const [anonKey, setAnonKey] = useState(config.anonKey || '');
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const handleSaveAndTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setTestResult(null);

    const success = await db.updateSupabaseConfig(url, anonKey);
    setIsSaving(false);
    if (success) {
      setTestResult('Successfully connected to Supabase PostgreSQL database!');
    } else {
      setTestResult(db.getConfig().statusMessage);
    }
    onRefresh();
  };

  const handleResetBaseline = () => {
    if (
      confirm(
        'Reset local database to Ghanaian supermarket baseline (Accra Mall, Indomie, Eva Water, Milo, etc.)?'
      )
    ) {
      db.resetToFreshBaseline();
      onRefresh();
      alert('Database baseline re-initialized.');
    }
  };

  const copyMigrationSql = () => {
    const sql = `-- Apply this in your Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  barcode TEXT NOT NULL,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  stock_quantity INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  payment_method TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);`;
    navigator.clipboard.writeText(sql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" />
            <h3 className="font-extrabold text-base text-slate-900">Supabase Database Integration</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Supabase Settings"
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Pill */}
        <div className="my-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-3 h-3 rounded-full ${
                config.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-emerald-500'
              }`}
            ></span>
            <div>
              <p className="text-xs font-bold text-slate-900">
                {config.isConnected ? 'Connected to Live Supabase' : 'Database Engine Operational'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">{config.statusMessage}</p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
            Realtime Ready
          </span>
        </div>

        {/* Database Credentials Form */}
        <form onSubmit={handleSaveAndTest} className="space-y-3 text-xs font-medium text-slate-700">
          <div>
            <label className="block font-bold mb-1">Supabase Project URL</label>
            <input
              type="url"
              placeholder="https://xyzcompany.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">Supabase Anon Key (Public API Key)</label>
            <input
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold ${
                testResult.includes('Success')
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              {testResult}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold rounded-xl transition shadow-md shadow-emerald-600/20"
            >
              {isSaving ? 'Testing Connection...' : 'Save & Connect Supabase'}
            </button>
          </div>
        </form>

        {/* Database Tables Inspector */}
        <div className="mt-5 pt-4 border-t border-slate-200">
          <h4 className="font-bold text-xs text-slate-800 mb-2 flex items-center justify-between">
            <span>Database Tables & Ledger State</span>
            <span className="text-[10px] text-slate-400 font-normal">Active Schema</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex justify-between">
              <span className="text-slate-600">public.products:</span>
              <strong className="text-slate-900">{db.getProducts().length} records</strong>
            </div>
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex justify-between">
              <span className="text-slate-600">public.sales:</span>
              <strong className="text-slate-900">{db.getSales().length} orders</strong>
            </div>
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex justify-between">
              <span className="text-slate-600">public.tenants:</span>
              <strong className="text-slate-900">{db.getTenants().length} shops</strong>
            </div>
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex justify-between">
              <span className="text-slate-600">public.movements:</span>
              <strong className="text-slate-900">{db.getInventoryMovements().length} ledger rows</strong>
            </div>
          </div>
        </div>

        {/* Tools: Copy Migration SQL and Reset */}
        <div className="mt-5 pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={copyMigrationSql}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition"
          >
            <Copy className="w-3.5 h-3.5 text-slate-500" />
            <span>{copiedSql ? 'Copied to Clipboard!' : 'Copy SQL Schema'}</span>
          </button>

          <button
            type="button"
            onClick={handleResetBaseline}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-seed Baseline</span>
          </button>
        </div>
      </div>
    </div>
  );
};
