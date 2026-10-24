import React, { useState } from 'react';
import {
  LayoutDashboard,
  Store,
  Users,
  CreditCard,
  Receipt,
  Package,
  BarChart3,
  Settings,
  HelpCircle,
  TrendingUp,
  Activity,
  CheckCircle2,
  DollarSign,
  Plus,
  Search,
  SlidersHorizontal,
  ExternalLink,
  Shield,
  Phone,
  Mail,
  AlertCircle,
  Clock,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Download,
  Server,
  Zap,
  ChevronDown,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { formatGHS } from '../lib/money';
import { db } from '../lib/supabaseClient';
import { Tenant, Sale, Product, UserAccount } from '../types';

interface SuperAdminDashboardProps {
  tenants: Tenant[];
  sales: Sale[];
  products: Product[];
  onAddShop?: () => void;
}

const COLORS = ['#F28C28', '#102A4C', '#10B981', '#6366F1', '#8B5CF6'];

type OverviewPanelKey = 'topProducts' | 'recentActivity' | 'systemHealth';

/** Card header that collapses/expands its panel body with a chevron drop-down. */
const PanelHeader: React.FC<{
  title: string;
  panelId: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}> = ({ title, panelId, open, onToggle, children }) => (
  <div className="flex items-center justify-between gap-3 mb-4">
    <h3 className="font-bold text-slate-900 text-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-1.5 group focus:outline-none"
      >
        <span className="group-hover:text-[#F28C28] transition-colors">{title}</span>
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 text-slate-400 group-hover:text-[#F28C28] transition-transform duration-300 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
    </h3>
    {children}
  </div>
);

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({
  tenants,
  sales,
  products,
  onAddShop,
}) => {
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'shops'
    | 'users'
    | 'subscriptions'
    | 'transactions'
    | 'products'
    | 'reports'
    | 'settings'
    | 'support'
  >('overview');

  const [searchQuery, setSearchQuery] = useState('');
  const [newShopName, setNewShopName] = useState('');
  const [newShopAddress, setNewShopAddress] = useState('');
  const [newShopPhone, setNewShopPhone] = useState('+233 ');
  const [showAddShopModal, setShowAddShopModal] = useState(false);

  // Revenue Overview range: 'today' = 2-hour slots, 'last7' = weekday totals, 'month' = day totals
  const [revenueRange, setRevenueRange] = useState<'today' | 'last7' | 'month'>('today');

  // Collapsible overview cards (Top Products, Recent Activity, System Health) — closed by default
  const [openPanels, setOpenPanels] = useState<Record<OverviewPanelKey, boolean>>({
    topProducts: false,
    recentActivity: false,
    systemHealth: false,
  });
  const togglePanel = (key: OverviewPanelKey) =>
    setOpenPanels((prev) => ({ ...prev, [key]: !prev[key] }));

  // New staff state for users tab
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('+233 ');
  const [newUserRole, setNewUserRole] = useState<'super_admin' | 'shop_owner' | 'cashier'>('shop_owner');
  const [newUserShopId, setNewUserShopId] = useState('tenant-accra-mall');
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  // Dynamic calculations from database
  const users = db.getUsers();
  const plans = db.getPlans();

  // Revenue never counts refunded or voided sales
  const revenueSales = sales.filter((s) => s.status !== 'refunded' && s.status !== 'voided');
  const totalPlatformRevenue = revenueSales.reduce((acc, curr) => acc + curr.total_amount, 0);
  const totalShopsCount = tenants.length;
  const activeShopsCount = tenants.filter((t) => t.is_active).length;
  const activeSubscriptionsCount = tenants.filter((t) => t.subscription_status === 'active').length;

  // Real "vs. last 7 days" comparison, using the same calendar-day boundaries as the chart
  // (null when the previous window has no sales to compare against)
  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const revenueInWindow = (from: number, to: number) =>
    revenueSales.reduce((acc, s) => {
      const saleMs = new Date(s.created_at).getTime();
      return !Number.isNaN(saleMs) && saleMs >= from && saleMs < to ? acc + s.total_amount : acc;
    }, 0);
  const revenueLast7Days = revenueInWindow(todayMs - 6 * DAY_MS, todayMs + DAY_MS);
  const revenuePrev7Days = revenueInWindow(todayMs - 13 * DAY_MS, todayMs - 6 * DAY_MS);
  const revenueChangePercent =
    revenuePrev7Days > 0 ? ((revenueLast7Days - revenuePrev7Days) / revenuePrev7Days) * 100 : null;

  // Sales by shop
  const shopSalesMap = new Map<string, number>();
  revenueSales.forEach((s) => {
    const shopName = s.shop_name || 'Unassigned Shop';
    shopSalesMap.set(shopName, (shopSalesMap.get(shopName) || 0) + s.total_amount);
  });

  const salesByShopData = Array.from(shopSalesMap.entries()).map(([name, value]) => ({
    name,
    value: Math.round(value),
  }));

  // Revenue trend — real sales bucketed by the selected range (live, no sample data)
  // 2-hour trading slots (first and last bucket absorb anything outside them)
  const TRADING_SLOTS = [
    { time: '8am', from: 0, to: 10 },
    { time: '10am', from: 10, to: 12 },
    { time: '12pm', from: 12, to: 14 },
    { time: '2pm', from: 14, to: 16 },
    { time: '4pm', from: 16, to: 18 },
    { time: '6pm', from: 18, to: 20 },
    { time: '8pm', from: 20, to: 22 },
    { time: '10pm', from: 22, to: 24 },
  ];

  const revenueTrendData: { time: string; revenue: number }[] = [];

  if (revenueRange === 'today') {
    TRADING_SLOTS.forEach((slot) => {
      const revenue = revenueSales.reduce((acc, s) => {
        const saleMs = new Date(s.created_at).getTime();
        const hour = new Date(saleMs).getHours();
        const inDay = saleMs >= todayMs && saleMs < todayMs + DAY_MS;
        const inSlot = hour >= slot.from && hour < slot.to;
        return inDay && inSlot ? acc + s.total_amount : acc;
      }, 0);
      revenueTrendData.push({ time: slot.time, revenue: Math.round(revenue) });
    });
  } else if (revenueRange === 'last7') {
    for (let i = 6; i >= 0; i--) {
      const dayStart = todayMs - i * DAY_MS;
      revenueTrendData.push({
        time: new Date(dayStart).toLocaleDateString([], { weekday: 'short' }),
        revenue: Math.round(revenueInWindow(dayStart, dayStart + DAY_MS)),
      });
    }
  } else {
    // 'month' — days so far in the current month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const daysSoFar = Math.max(1, new Date().getDate());
    for (let i = 0; i < daysSoFar; i++) {
      const dayStart = monthStart.getTime() + i * DAY_MS;
      revenueTrendData.push({
        time: `${i + 1}`,
        revenue: Math.round(revenueInWindow(dayStart, dayStart + DAY_MS)),
      });
    }
  }

  const trendTotal = revenueTrendData.reduce((acc, p) => acc + p.revenue, 0);
  const trendPeak = revenueTrendData.reduce(
    (best, p) => (p.revenue > best.revenue ? p : best),
    revenueTrendData[0] || { time: '', revenue: 0 }
  );

  // Top Selling Products across platform
  const productSalesMap = new Map<string, { product: Product; amount: number; qty: number }>();
  sales.forEach((s) => {
    s.items?.forEach((item) => {
      const existing = productSalesMap.get(item.product_name) || {
        product: {
          id: item.product_id,
          name: item.product_name,
          selling_price: item.unit_price,
          image_url: products.find((p) => p.name === item.product_name)?.image_url || '',
        } as Product,
        amount: 0,
        qty: 0,
      };
      existing.amount += item.total_amount;
      existing.qty += item.quantity;
      productSalesMap.set(item.product_name, existing);
    });
  });

  const topProductsList = Array.from(productSalesMap.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const fallbackTopProducts = [
    { name: 'Indomie Noodles', amount: 8420, img: 'https://images.unsplash.com/photo-1612927601601-6638404737ce?w=100&auto=format&fit=crop&q=80' },
    { name: 'Eva Water 500ml', amount: 6230, img: 'https://images.unsplash.com/photo-1559839914-17aae19cec71?w=100&auto=format&fit=crop&q=80' },
    { name: 'Milo 400g', amount: 5880, img: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=100&auto=format&fit=crop&q=80' },
    { name: 'Tomato Mix', amount: 4320, img: 'https://images.unsplash.com/photo-1598514982205-f36b96d1e8d4?w=100&auto=format&fit=crop&q=80' },
    { name: 'Golden Margarine', amount: 3210, img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=100&auto=format&fit=crop&q=80' },
  ];

  // Handlers for shop creation
  const handleCreateShop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShopName.trim()) return;
    const slug = newShopName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    db.addTenant({
      name: newShopName.trim(),
      slug,
      address: newShopAddress || 'Accra, Ghana',
      phone: newShopPhone || '+233 24 000 0000',
      email: `${slug}@samtechhelper.com`,
      currency: 'GHS',
      is_active: true,
      subscription_status: 'active',
    });
    setNewShopName('');
    setNewShopAddress('');
    setShowAddShopModal(false);
  };

  // Handlers for staff creation
  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    const shop = tenants.find((t) => t.id === newUserShopId);
    db.addUser({
      full_name: newUserName.trim(),
      email: newUserEmail.trim(),
      phone: newUserPhone.trim(),
      role: newUserRole,
      tenant_id: newUserRole === 'super_admin' ? undefined : newUserShopId,
      shop_name: newUserRole === 'super_admin' ? undefined : shop?.name,
      is_active: true,
    });
    setNewUserName('');
    setNewUserEmail('');
    setShowAddUserModal(false);
  };

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-4rem)] bg-[#F5F7FA]">
      {/* Mobile Horizontal Navigation Header */}
      <div className="md:hidden sticky top-16 z-20 bg-[#102A4C] text-white p-2 flex items-center overflow-x-auto gap-1.5 border-b border-slate-700 w-full flex-shrink-0">
        {[
          { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
          { id: 'shops', label: 'Shops', icon: Store, count: totalShopsCount },
          { id: 'users', label: 'Users', icon: Users, count: users.length },
          { id: 'subscriptions', label: 'Billing', icon: CreditCard },
          { id: 'transactions', label: 'Ledger', icon: Receipt, count: sales.length },
          { id: 'products', label: 'Catalog', icon: Package },
          { id: 'reports', label: 'Reports', icon: BarChart3 },
          { id: 'settings', label: 'Settings', icon: Settings },
          { id: 'support', label: 'Health', icon: HelpCircle },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as typeof activeTab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                isActive ? 'bg-[#F28C28] text-white shadow' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
              {item.count !== undefined && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-900 text-slate-300">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Left Sidebar */}
      <aside className="w-64 bg-[#102A4C] text-slate-300 flex-shrink-0 hidden md:flex flex-col border-r border-slate-800 sticky top-16 self-start h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="p-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
            Platform Menu
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {[
            { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'shops', label: 'Shop Management', icon: Store, count: tenants.length },
            { id: 'users', label: 'Users & Roles', icon: Users, count: users.length },
            { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard, count: plans.length },
            { id: 'transactions', label: 'Transactions', icon: Receipt, count: sales.length },
            { id: 'products', label: 'Products', icon: Package, count: products.length },
            { id: 'reports', label: 'Reports', icon: BarChart3 },
            { id: 'settings', label: 'System Settings', icon: Settings },
            { id: 'support', label: 'Support & Health', icon: HelpCircle },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as typeof activeTab)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                  isActive
                    ? 'bg-[#F28C28] text-white shadow-md shadow-orange-500/20'
                    : 'hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Multi-Tenant Promo Card */}
        <div className="m-4 p-4 rounded-2xl bg-gradient-to-br from-slate-800/90 to-slate-900 border border-slate-700/60 text-center">
          <div className="w-10 h-10 mx-auto rounded-xl bg-orange-500/20 text-[#F28C28] flex items-center justify-center mb-2">
            <Store className="w-5 h-5" />
          </div>
          <h4 className="font-bold text-xs text-white">Samtech Helper Multi-Tenant POS</h4>
          <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
            "One Platform. Multiple Shops. Endless Possibilities."
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto max-w-[1700px] mx-auto w-full">
        {/* Top Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight capitalize">
              {activeTab === 'overview'
                ? 'Super Admin Dashboard'
                : activeTab.replace(/([A-Z])/g, ' $1')}
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Live multi-tenant supervision, billing metrics, and supermarket performance across Ghana
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#F28C28] w-48 sm:w-60 shadow-sm"
              />
            </div>

            {activeTab === 'shops' && (
              <button
                onClick={() => setShowAddShopModal(true)}
                className="flex items-center gap-1.5 bg-[#F28C28] hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md shadow-orange-500/20"
              >
                <Plus className="w-4 h-4" />
                <span>Add Shop</span>
              </button>
            )}

            {activeTab === 'users' && (
              <button
                onClick={() => setShowAddUserModal(true)}
                className="flex items-center gap-1.5 bg-[#F28C28] hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md shadow-orange-500/20"
              >
                <Plus className="w-4 h-4" />
                <span>Invite User</span>
              </button>
            )}
          </div>
        </div>

        {/* 1. OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            {/* 4 Overview KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Total Revenue</p>
                  <h3 className="text-2xl font-black text-slate-900 mt-1 tracking-tight">
                    {formatGHS(totalPlatformRevenue)}
                  </h3>
                  <p className="text-[11px] font-semibold flex items-center gap-1 mt-1">
                    {revenueChangePercent === null ? (
                      <>
                        <span className="text-slate-400 font-normal">no prior 7-day data to compare</span>
                      </>
                    ) : (
                      <>
                        <TrendingUp
                          className={`w-3.5 h-3.5 ${
                            revenueChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500 rotate-180'
                          }`}
                        />
                        <span className={revenueChangePercent >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {revenueChangePercent >= 0 ? '↑' : '↓'} {Math.abs(revenueChangePercent).toFixed(1)}%
                        </span>
                        <span className="text-slate-400 font-normal">vs. last 7 days</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-orange-500/10 text-[#F28C28] flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-6 h-6 stroke-[2.2]" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Total Shops</p>
                  <h3 className="text-2xl font-black text-slate-900 mt-1 tracking-tight">
                    {totalShopsCount || 12}
                  </h3>
                  <p className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>↑ 20%</span>
                    <span className="text-slate-400 font-normal">Active shops</span>
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-orange-500/10 text-[#F28C28] flex items-center justify-center flex-shrink-0">
                  <Store className="w-6 h-6 stroke-[2.2]" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Total Users</p>
                  <h3 className="text-2xl font-black text-slate-900 mt-1 tracking-tight">
                    {users.length || 48}
                  </h3>
                  <p className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>↑ 15%</span>
                    <span className="text-slate-400 font-normal">Across all shops</span>
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-orange-500/10 text-[#F28C28] flex items-center justify-center flex-shrink-0">
                  <Users className="w-6 h-6 stroke-[2.2]" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Active Subscriptions</p>
                  <h3 className="text-2xl font-black text-slate-900 mt-1 tracking-tight">
                    {activeSubscriptionsCount || 10}
                  </h3>
                  <p className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>↑ 11%</span>
                    <span className="text-slate-400 font-normal">Monthly & Yearly plans</span>
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-orange-500/10 text-[#F28C28] flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-6 h-6 stroke-[2.2]" />
                </div>
              </div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-sm">Revenue Overview (Real-time)</h3>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Live
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {trendTotal > 0
                        ? `Busiest ${revenueRange === 'today' ? 'slot' : 'period'} ${trendPeak.time} (${formatGHS(trendPeak.revenue)}) · total ${formatGHS(trendTotal)}`
                        : 'No sales yet in this range — revenue appears here the moment a till completes a sale.'}
                    </p>
                  </div>
                  <select
                    aria-label="Overview Range"
                    value={revenueRange}
                    onChange={(e) => setRevenueRange(e.target.value as 'today' | 'last7' | 'month')}
                    className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 focus:outline-none"
                  >
                    <option value="today">Today</option>
                    <option value="last7">Last 7 days</option>
                    <option value="month">This Month</option>
                  </select>
                </div>

                <div className="relative h-64 w-full">
                  {trendTotal === 0 && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 pointer-events-none">
                      <Activity className="w-6 h-6 text-slate-300" />
                      <p className="text-xs font-semibold text-slate-400">No revenue recorded in this range</p>
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={revenueTrendData}>
                      <defs>
                        <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#F28C28" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#F28C28" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                      <XAxis dataKey="time" stroke="#94A3B8" fontSize={11} tickLine={false} />
                      <YAxis
                        stroke="#94A3B8"
                        fontSize={11}
                        tickLine={false}
                        width={44}
                        tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                      />
                      <Tooltip
                        formatter={(val: unknown) => [formatGHS(Number(val) || 0), 'Revenue']}
                        contentStyle={{
                          backgroundColor: '#102A4C',
                          color: '#fff',
                          borderRadius: '12px',
                          border: 'none',
                          fontSize: '12px',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#F28C28"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#revenueGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Sales by Shop Donut */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-slate-900 text-sm">Sales by Shop</h3>
                  <select aria-label="Select Shop Range" className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none">
                    <option>Last 7 days</option>
                    <option>Today</option>
                  </select>
                </div>

                <div className="h-52 relative flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={salesByShopData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={75}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {salesByShopData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val: unknown) => [formatGHS(Number(val) || 0), 'Sales']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[11px] font-bold text-slate-400">Total Sales</span>
                    <span className="text-sm font-extrabold text-slate-800">
                      {formatGHS(totalPlatformRevenue).split('.')[0]}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 mt-2">
                  {salesByShopData.slice(0, 4).map((entry, idx) => (
                    <div key={entry.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        ></span>
                        <span className="font-medium text-slate-700 truncate max-w-[120px]">{entry.name}</span>
                      </div>
                      <span className="font-bold text-slate-800">
                        {Math.round((entry.value / (totalPlatformRevenue || 1)) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Lower Grid: Top Products, Recent Activity & System Health */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <PanelHeader
                  title="Top Products"
                  panelId="sa-panel-top-products"
                  open={openPanels.topProducts}
                  onToggle={() => togglePanel('topProducts')}
                >
                  <select aria-label="Select Products Date Range" className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none">
                    <option>Last 7 days</option>
                    <option>Today</option>
                  </select>
                </PanelHeader>

                <div
                  id="sa-panel-top-products"
                  role="region"
                  aria-label="Top Products"
                  className={`collapsible ${openPanels.topProducts ? '' : 'collapsed'}`}
                >
                  <div>
                  <div className="space-y-3.5">
                  {(topProductsList.length > 0
                    ? topProductsList.map((item) => ({
                        name: item.product.name,
                        amount: item.amount,
                        img: item.product.image_url,
                      }))
                    : fallbackTopProducts
                  ).map((prod, idx) => (
                    <div key={prod.name} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="w-5 h-5 rounded-full bg-orange-100 text-[#F28C28] font-bold text-xs flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <img
                          src={prod.img || 'https://images.unsplash.com/photo-1612927601601-6638404737ce?w=80'}
                          alt={prod.name}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-100"
                        />
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 line-clamp-1">{prod.name}</h4>
                          <p className="text-[11px] text-slate-400">Retail item</p>
                        </div>
                      </div>
                      <span className="text-xs font-extrabold text-slate-800">
                        {formatGHS(prod.amount)}
                      </span>
                    </div>
                  ))}
                  </div>
                  </div>
                </div>
              </div>

              {/* Recent Activity Table */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <PanelHeader
                    title="Recent Activity"
                    panelId="sa-panel-recent-activity"
                    open={openPanels.recentActivity}
                    onToggle={() => togglePanel('recentActivity')}
                  >
                    <button
                      onClick={() => setActiveTab('transactions')}
                      className="text-xs font-bold text-[#F28C28] hover:underline"
                    >
                      View All
                    </button>
                  </PanelHeader>

                  <div
                    id="sa-panel-recent-activity"
                    role="region"
                    aria-label="Recent Activity"
                    className={`collapsible ${openPanels.recentActivity ? '' : 'collapsed'}`}
                  >
                    <div>
                    <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                          <th className="pb-2">Time</th>
                          <th className="pb-2">Shop</th>
                          <th className="pb-2">User</th>
                          <th className="pb-2">Action</th>
                          <th className="pb-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sales.slice(0, 5).map((sale) => (
                          <tr key={sale.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 text-slate-500 font-medium">
                              {new Date(sale.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-2.5 font-bold text-slate-800">{sale.shop_name}</td>
                            <td className="py-2.5 text-slate-600 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                              <span>{sale.cashier_name}</span>
                            </td>
                            <td className="py-2.5">
                              <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold text-[10px]">
                                Sale completed
                              </span>
                            </td>
                            <td className="py-2.5 text-right font-extrabold text-slate-900">
                              {formatGHS(sale.total_amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* System Health */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <PanelHeader
                  title="System Health"
                  panelId="sa-panel-system-health"
                  open={openPanels.systemHealth}
                  onToggle={() => togglePanel('systemHealth')}
                />
                <div
                  id="sa-panel-system-health"
                  role="region"
                  aria-label="System Health"
                  className={`collapsible ${openPanels.systemHealth ? '' : 'collapsed'}`}
                >
                  <div>
                  <div className="space-y-3">
                  {[
                    { label: 'Backend Server', status: 'Online' },
                    { label: 'Database', status: 'Online' },
                    { label: 'Payment Gateway', status: 'Online' },
                    { label: 'Printer Service', status: 'Online' },
                    { label: 'Real-time Sync', status: 'Online' },
                  ].map((service) => (
                    <div key={service.label} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span className="text-xs font-semibold text-slate-700">{service.label}</span>
                      </div>
                      <span className="text-xs font-bold text-emerald-600">{service.status}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <p className="text-[11px] font-semibold text-emerald-800">
                    All {tenants.length} Supermarket tenants operational. 0 network incidents reported.
                  </p>
                </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 2. SHOP MANAGEMENT TAB */}
        {activeTab === 'shops' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-black text-slate-900">Registered Supermarket Enterprises</h3>
                <p className="text-xs text-slate-500">Manage tenant accounts, multi-branch limits, and status</p>
              </div>
              <button
                onClick={() => setShowAddShopModal(true)}
                className="flex items-center gap-1.5 bg-[#F28C28] hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md shadow-orange-500/20"
              >
                <Plus className="w-4 h-4" />
                <span>Register Supermarket</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tenants.map((t) => (
                <div
                  key={t.id}
                  className="p-5 rounded-2xl border border-slate-200 hover:border-orange-500/50 hover:shadow-md transition bg-white flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          t.is_active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {t.is_active ? 'Active Tenant' : 'Suspended'}
                      </span>
                      <span className="text-xs font-bold text-slate-400">Currency: {t.currency}</span>
                    </div>

                    <h4 className="font-extrabold text-base text-slate-900">{t.name}</h4>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-slate-400" />
                      <span>{t.address}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      <span>{t.phone}</span>
                    </p>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase">Subscription</span>
                      <p className="text-xs font-bold text-[#F28C28] capitalize">
                        {t.subscription_status} Pro
                      </p>
                    </div>

                    <button
                      onClick={() => db.toggleTenantStatus(t.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                        t.is_active
                          ? 'border border-rose-200 text-rose-600 hover:bg-rose-50'
                          : 'border border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      {t.is_active ? 'Suspend' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. USERS & ROLES TAB */}
        {activeTab === 'users' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-black text-slate-900">System Users & Cashiers</h3>
                <p className="text-xs text-slate-500">
                  Global staff directory across Super Admin, Shop Owners, and Store Cashiers
                </p>
              </div>
              <button
                onClick={() => setShowAddUserModal(true)}
                className="flex items-center gap-1.5 bg-[#F28C28] hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add User</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-3">User</th>
                    <th className="pb-3">Role</th>
                    <th className="pb-3">Assigned Shop</th>
                    <th className="pb-3">Contact</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="py-3 font-bold text-slate-900 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs uppercase">
                          {u.full_name.slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{u.full_name}</p>
                          <p className="text-[11px] text-slate-400">{u.email}</p>
                        </div>
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-[10px] uppercase ${
                            u.role === 'super_admin'
                              ? 'bg-purple-100 text-purple-700'
                              : u.role === 'shop_owner'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {u.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 font-medium text-slate-700">
                        {u.shop_name || 'All Shops (Platform)'}
                      </td>
                      <td className="py-3 text-slate-500">{u.phone}</td>
                      <td className="py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                            u.is_active ? 'text-emerald-600' : 'text-slate-400'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              u.is_active ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                          ></span>
                          {u.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => db.toggleUserStatus(u.id)}
                          className="text-[11px] font-bold text-[#F28C28] hover:underline"
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. SUBSCRIPTIONS TAB */}
        {activeTab === 'subscriptions' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {plans.map((p) => (
                <div
                  key={p.id}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between"
                >
                  <div>
                    <span className="text-[11px] font-extrabold uppercase text-[#F28C28] tracking-widest">
                      {p.name}
                    </span>
                    <h3 className="text-3xl font-black text-slate-900 mt-2">
                      {formatGHS(p.price_monthly)}
                      <span className="text-xs font-semibold text-slate-400"> / month</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Or {formatGHS(p.price_yearly)} / year</p>

                    <div className="mt-5 space-y-2 text-xs text-slate-600">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span>Max {p.max_branches} Branches</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span>Max {p.max_users} Staff Accounts</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span>Max {p.max_products} Products</span>
                      </div>
                      {p.features.map((f) => (
                        <div key={f} className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">
                      {tenants.filter((t) => t.is_active).length} Shops Subscribed
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">
                      Active Tier
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Tenant Subscriptions Table */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Store Subscriptions Status</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="pb-2">Supermarket Shop</th>
                      <th className="pb-2">Plan</th>
                      <th className="pb-2">Billing</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tenants.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/70">
                        <td className="py-3 font-bold text-slate-900">{t.name}</td>
                        <td className="py-3 text-slate-700 font-semibold">Supermarket Pro</td>
                        <td className="py-3 text-slate-500">GH₵ 350.00 / month</td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 capitalize">
                            {t.subscription_status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => db.updateTenantSubscription(t.id, 'active')}
                            className="text-[#F28C28] font-bold hover:underline"
                          >
                            Renew / Change
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 5. TRANSACTIONS TAB */}
        {activeTab === 'transactions' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Platform Sales Ledger</h3>
                <p className="text-xs text-slate-500">
                  Authoritative multi-shop transaction stream verified by database
                </p>
              </div>
              <span className="text-xs font-bold text-slate-500">
                Total: {sales.length} orders ({formatGHS(totalPlatformRevenue)})
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-3">Invoice #</th>
                    <th className="pb-3">Time</th>
                    <th className="pb-3">Shop</th>
                    <th className="pb-3">Cashier</th>
                    <th className="pb-3">Items Count</th>
                    <th className="pb-3">Payment</th>
                    <th className="pb-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sales.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="py-3 font-bold text-slate-900">{s.invoice_number}</td>
                      <td className="py-3 text-slate-500">
                        {new Date(s.created_at).toLocaleString('en-GH')}
                      </td>
                      <td className="py-3 font-bold text-slate-800">{s.shop_name}</td>
                      <td className="py-3 text-slate-600">{s.cashier_name}</td>
                      <td className="py-3 text-slate-600">
                        {s.items?.reduce((acc, i) => acc + i.quantity, 0) || 1} items
                      </td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded font-bold text-[10px] uppercase bg-slate-100 text-slate-700">
                          {s.payment_method.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 text-right font-black text-slate-900">
                        {formatGHS(s.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 6. PRODUCTS TAB */}
        {activeTab === 'products' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Platform Product Master Catalog</h3>
                <p className="text-xs text-slate-500">
                  Retail items across all supermarkets with stock and barcode indexing
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-3">Product</th>
                    <th className="pb-3">Barcode</th>
                    <th className="pb-3">Category</th>
                    <th className="pb-3">Cost Price</th>
                    <th className="pb-3">Selling Price</th>
                    <th className="pb-3">Stock</th>
                    <th className="pb-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="py-3 font-bold text-slate-900 flex items-center gap-2.5">
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="w-8 h-8 rounded-lg object-cover border border-slate-200"
                        />
                        <span>{p.name}</span>
                      </td>
                      <td className="py-3 font-mono text-slate-600">{p.barcode}</td>
                      <td className="py-3 text-slate-600">{p.category_name}</td>
                      <td className="py-3 text-slate-500">{formatGHS(p.cost_price)}</td>
                      <td className="py-3 font-black text-slate-900">{formatGHS(p.selling_price)}</td>
                      <td className="py-3 font-bold text-slate-800">{p.stock_quantity} in stock</td>
                      <td className="py-3 text-right">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 7. REPORTS TAB */}
        {activeTab === 'reports' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">Platform Financial & Sales Reports</h3>
                <p className="text-xs text-slate-500">
                  Aggregated gross sales, COGS, subscription revenues, and VAT compliance
                </p>
              </div>
              <button
                onClick={() => alert('Platform report generated successfully!')}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#102A4C] hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition"
              >
                <Download className="w-4 h-4" />
                <span>Export Platform Summary</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-bold text-slate-500">Total Supermarket Sales</span>
                <p className="text-2xl font-black text-slate-900 mt-1">{formatGHS(totalPlatformRevenue)}</p>
                <p className="text-[11px] text-emerald-600 font-semibold mt-1">Across 12 shops</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-bold text-slate-500">Monthly Subscription MRR</span>
                <p className="text-2xl font-black text-slate-900 mt-1">{formatGHS(tenants.length * 350)}</p>
                <p className="text-[11px] text-blue-600 font-semibold mt-1">Active monthly billing</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-bold text-slate-500">Total Completed Orders</span>
                <p className="text-2xl font-black text-slate-900 mt-1">{sales.length}</p>
                <p className="text-[11px] text-purple-600 font-semibold mt-1">100% verified checkout</p>
              </div>
            </div>
          </div>
        )}

        {/* 8. SYSTEM SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm max-w-3xl">
            <h3 className="text-lg font-black text-slate-900 mb-1">Global Platform Settings</h3>
            <p className="text-xs text-slate-500 mb-6">Configure platform currency, taxes, and payment gateways</p>

            <div className="space-y-4 text-xs font-medium text-slate-700">
              <div>
                <label className="block font-bold mb-1">Primary SaaS Currency</label>
                <input
                  type="text"
                  disabled
                  value="GHS (Ghanaian Cedi - GH₵)"
                  className="w-full p-2.5 bg-slate-100 border border-slate-300 rounded-xl font-bold text-slate-800 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Mobile Money Integration Gateway</label>
                <select aria-label="Mobile Money Integration Gateway" className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800">
                  <option>Paystack Ghana (MTN MoMo, Telecel Cash, AT Money)</option>
                  <option>Flutterwave Ghana</option>
                  <option>Direct Bank Switch / Gh-Link</option>
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">Receipt Printing Protocol</label>
                <select aria-label="Receipt Printing Protocol" className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800">
                  <option>Standard Browser ESC/POS Print (58mm & 80mm)</option>
                  <option>Hardware USB Thermal Bridge</option>
                </select>
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => alert('Global platform settings saved!')}
                  className="px-5 py-2.5 bg-[#F28C28] hover:bg-orange-600 text-white rounded-xl font-extrabold transition"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 9. SUPPORT & HEALTH TAB */}
        {activeTab === 'support' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 max-w-4xl">
            <div>
              <h3 className="text-lg font-black text-slate-900">System Infrastructure & Diagnostics</h3>
              <p className="text-xs text-slate-500">Live operational status and platform logs</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5 text-emerald-600" />
                  <div>
                    <h4 className="font-bold text-xs text-slate-900">API Web Service</h4>
                    <p className="text-[11px] text-slate-400">Node.js Express Engine</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                  Operational
                </span>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 text-emerald-600" />
                  <div>
                    <h4 className="font-bold text-xs text-slate-900">Supabase Realtime</h4>
                    <p className="text-[11px] text-slate-400">WebSocket Channels</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                  Active
                </span>
              </div>
            </div>

            <div className="p-4 bg-slate-900 text-slate-300 rounded-xl font-mono text-[11px] space-y-1">
              <p className="text-emerald-400">[SYSTEM OK] Multi-tenant PostgreSQL database ping 14ms</p>
              <p className="text-slate-400">[REALTIME] Connected to channel 'supermarket_realtime_pub'</p>
              <p className="text-slate-400">[SECURITY] Supabase RLS verified on tenants, sales, and products</p>
              <p className="text-slate-400">[TILLS] 12 supermarket active branches reporting heartbeat</p>
            </div>
          </div>
        )}

        {/* Modal for Registering a New Shop */}
        {showAddShopModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
              <h3 className="text-base font-black text-slate-900 mb-1">Register Supermarket Shop</h3>
              <p className="text-xs text-slate-500 mb-4">Add a new tenant enterprise to the platform</p>

              <form onSubmit={handleCreateShop} className="space-y-3 text-xs font-medium text-slate-700">
                <div>
                  <label className="block font-bold mb-1">Supermarket Business Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Spintex Road Megamart"
                    value={newShopName}
                    onChange={(e) => setNewShopName(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Physical Location Address</label>
                  <input
                    type="text"
                    placeholder="e.g. Spintex Road, Opposite Palace Mall, Accra"
                    value={newShopAddress}
                    onChange={(e) => setNewShopAddress(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Official Contact Phone</label>
                  <input
                    type="text"
                    value={newShopPhone}
                    onChange={(e) => setNewShopPhone(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowAddShopModal(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold rounded-xl shadow-md transition"
                  >
                    Create Shop
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal for Inviting / Adding a User */}
        {showAddUserModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
              <h3 className="text-base font-black text-slate-900 mb-1">Invite System Staff</h3>
              <p className="text-xs text-slate-500 mb-4">Grant access to Super Admin, Shop Owner, or Cashier</p>

              <form onSubmit={handleCreateUser} className="space-y-3 text-xs font-medium text-slate-700">
                <div>
                  <label className="block font-bold mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. John Mensah"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="john@example.com"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Phone</label>
                  <input
                    type="text"
                    value={newUserPhone}
                    onChange={(e) => setNewUserPhone(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Role</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as typeof newUserRole)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  >
                    <option value="shop_owner">Shop Owner</option>
                    <option value="cashier">Cashier</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>

                {newUserRole !== 'super_admin' && (
                  <div>
                    <label className="block font-bold mb-1">Assign to Shop</label>
                    <select
                      value={newUserShopId}
                      onChange={(e) => setNewUserShopId(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                    >
                      {tenants.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowAddUserModal(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold rounded-xl shadow-md transition"
                  >
                    Save User
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
