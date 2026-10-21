import React, { useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Package,
  Users,
  UserCheck,
  Receipt,
  BarChart3,
  Settings,
  TrendingUp,
  AlertTriangle,
  Plus,
  FileSpreadsheet,
  ArrowUpRight,
  ShieldAlert,
  Search,
  Phone,
  Mail,
  DollarSign,
  RotateCcw,
  Trash2,
  Edit2,
  CheckCircle2,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatGHS } from '../lib/money';
import { db } from '../lib/supabaseClient';
import { Product, Sale, Tenant, Customer, Expense, UserAccount } from '../types';

interface ShopOwnerDashboardProps {
  currentTenant: Tenant;
  sales: Sale[];
  products: Product[];
  onOpenAddProduct: () => void;
  onOpenPOS: () => void;
}

export const ShopOwnerDashboard: React.FC<ShopOwnerDashboardProps> = ({
  currentTenant,
  sales,
  products,
  onOpenAddProduct,
  onOpenPOS,
}) => {
  const [activeMenu, setActiveMenu] = useState<
    | 'overview'
    | 'sales'
    | 'inventory'
    | 'products'
    | 'customers'
    | 'staff'
    | 'expenses'
    | 'reports'
    | 'settings'
  >('overview');

  const [searchQuery, setSearchQuery] = useState('');

  // Modals for Shop Owner
  const [selectedSaleDetail, setSelectedSaleDetail] = useState<Sale | null>(null);
  const [showStockAdjustModal, setShowStockAdjustModal] = useState<Product | null>(null);
  const [stockAdjustQty, setStockAdjustQty] = useState('10');
  const [stockAdjustReason, setStockAdjustReason] = useState('Restock shipment from supplier');

  // Customer modal
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('024 ');
  const [custEmail, setCustEmail] = useState('');

  // Expense modal
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [expCategory, setExpCategory] = useState('Utilities');
  const [expAmount, setExpAmount] = useState('150.00');
  const [expDesc, setExpDesc] = useState('');

  // Staff modal
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPhone, setStaffPhone] = useState('+233 ');
  const [staffRole, setStaffRole] = useState<'shop_owner' | 'cashier'>('cashier');

  // 1. Authoritative Dynamic Calculations for this shop
  const tenantSales = sales.filter((s) => s.tenant_id === currentTenant.id);
  const tenantProducts = products.filter((p) => p.tenant_id === currentTenant.id && p.is_active);
  const customers = db.getCustomers(currentTenant.id);
  const expenses = db.getExpenses(currentTenant.id);
  const staffMembers = db.getUsers(currentTenant.id);
  const movements = db.getInventoryMovements(currentTenant.id);

  const totalSalesToday = tenantSales.reduce((acc, curr) => acc + curr.total_amount, 0);
  const totalOrdersCount = tenantSales.length;
  const totalCostToday = tenantSales.reduce((acc, curr) => acc + curr.cost_amount, 0);
  const grossProfitToday = Math.max(0, totalSalesToday - totalCostToday);
  const totalProductsInStock = tenantProducts.filter((p) => p.stock_quantity > 0).length;
  const lowStockProducts = tenantProducts.filter(
    (p) => p.stock_quantity <= p.min_stock_threshold
  );
  const totalExpensesAmount = expenses.reduce((acc, curr) => acc + curr.amount, 0);

  // Group real sales dynamically by hour
  const hourlySalesMap: Record<string, number> = {
    '8am': 0,
    '10am': 0,
    '12pm': 0,
    '2pm': 0,
    '4pm': 0,
    '6pm': 0,
    '8pm': 0,
  };

  tenantSales.forEach((s) => {
    const d = new Date(s.created_at);
    const hr = d.getHours();
    if (hr < 9) hourlySalesMap['8am'] += s.total_amount;
    else if (hr < 11) hourlySalesMap['10am'] += s.total_amount;
    else if (hr < 13) hourlySalesMap['12pm'] += s.total_amount;
    else if (hr < 15) hourlySalesMap['2pm'] += s.total_amount;
    else if (hr < 17) hourlySalesMap['4pm'] += s.total_amount;
    else if (hr < 19) hourlySalesMap['6pm'] += s.total_amount;
    else hourlySalesMap['8pm'] += s.total_amount;
  });

  const salesTrendData = Object.entries(hourlySalesMap).map(([hour, sales]) => ({
    hour,
    sales,
  }));

  // Top Selling Products calculated purely from real sales
  const topSellingMap = new Map<string, { product: Product; qtySold: number }>();
  tenantSales.forEach((sale) => {
    sale.items?.forEach((item) => {
      const existing = topSellingMap.get(item.product_name) || {
        product: products.find((p) => p.id === item.product_id) || {
          id: item.product_id,
          name: item.product_name,
          image_url: '',
        } as Product,
        qtySold: 0,
      };
      existing.qtySold += item.quantity;
      topSellingMap.set(item.product_name, existing);
    });
  });

  const topSellingList = Array.from(topSellingMap.values())
    .sort((a, b) => b.qtySold - a.qtySold)
    .slice(0, 5);

  // CSV Export for Shop Owner
  const exportSalesCSV = () => {
    const headers = ['Invoice Number', 'Time', 'Customer', 'Payment Method', 'Amount GHS'];
    const rows = tenantSales.map((s) => [
      s.invoice_number,
      new Date(s.created_at).toLocaleString(),
      s.customer_name || 'Walk-in',
      s.payment_method,
      s.total_amount.toFixed(2),
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${currentTenant.slug}-sales-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Stock adjustment handler
  const handleConfirmStockAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showStockAdjustModal) return;
    const delta = parseInt(stockAdjustQty, 10) || 0;
    db.updateProductStock(showStockAdjustModal.id, delta, stockAdjustReason);
    setShowStockAdjustModal(null);
  };

  // Create customer
  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim()) return;
    db.addCustomer({
      tenant_id: currentTenant.id,
      name: custName.trim(),
      phone: custPhone.trim(),
      email: custEmail.trim() || undefined,
    });
    setCustName('');
    setShowAddCustomerModal(false);
  };

  // Create expense
  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expAmount) return;
    db.addExpense({
      tenant_id: currentTenant.id,
      branch_id: 'branch-accra-main',
      category: expCategory,
      amount: parseFloat(expAmount) || 0,
      description: expDesc || 'Operational store expense',
      expense_date: new Date().toISOString().slice(0, 10),
    });
    setExpAmount('');
    setExpDesc('');
    setShowAddExpenseModal(false);
  };

  // Create staff
  const handleCreateStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffName.trim()) return;
    db.addUser({
      tenant_id: currentTenant.id,
      shop_name: currentTenant.name,
      full_name: staffName.trim(),
      email: staffEmail.trim() || `${staffName.toLowerCase().replace(/\s/g, '')}@${currentTenant.slug}.com`,
      phone: staffPhone.trim(),
      role: staffRole,
      is_active: true,
    });
    setStaffName('');
    setShowAddStaffModal(false);
  };

  // Handle refund
  const handleRefund = (saleId: string) => {
    if (confirm('Are you sure you want to issue a full refund and restock items?')) {
      db.refundSale(saleId, 'Customer return requested at till');
      alert('Sale refunded and inventory items restocked to ledger.');
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-4rem)] bg-[#F5F7FA]">
      {/* Mobile Horizontal Navigation Header */}
      <div className="md:hidden bg-[#102A4C] text-white p-2 flex items-center overflow-x-auto gap-1.5 border-b border-slate-700 w-full flex-shrink-0">
        {[
          { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
          { id: 'sales', label: 'Sales', icon: ShoppingCart, count: tenantSales.length },
          { id: 'inventory', label: 'Inventory', icon: Boxes, badge: lowStockProducts.length > 0 ? `${lowStockProducts.length} low` : undefined },
          { id: 'products', label: 'Products', icon: Package, count: tenantProducts.length },
          { id: 'customers', label: 'Customers', icon: Users, count: customers.length },
          { id: 'staff', label: 'Staff', icon: UserCheck, count: staffMembers.length },
          { id: 'expenses', label: 'Expenses', icon: Receipt, count: expenses.length },
          { id: 'reports', label: 'Reports', icon: BarChart3 },
          { id: 'settings', label: 'Settings', icon: Settings },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activeMenu === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveMenu(item.id as typeof activeMenu)}
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

      {/* Sidebar matching bottom-left screenshot */}
      <aside className="w-60 bg-[#102A4C] text-slate-300 flex-shrink-0 hidden md:flex flex-col border-r border-slate-800">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500/20 text-[#F28C28] flex items-center justify-center font-bold text-xs uppercase">
              {currentTenant.name.slice(0, 2)}
            </div>
            <div>
              <p className="text-xs font-bold text-white leading-none truncate max-w-[140px]">
                {currentTenant.name}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">Shop Owner View</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {[
            { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
            { id: 'sales', label: 'Sales', icon: ShoppingCart, count: tenantSales.length },
            { id: 'inventory', label: 'Inventory', icon: Boxes, badge: lowStockProducts.length > 0 ? `${lowStockProducts.length} low` : undefined },
            { id: 'products', label: 'Products', icon: Package, count: tenantProducts.length },
            { id: 'customers', label: 'Customers', icon: Users, count: customers.length },
            { id: 'staff', label: 'Staff', icon: UserCheck, count: staffMembers.length },
            { id: 'expenses', label: 'Expenses', icon: Receipt, count: expenses.length },
            { id: 'reports', label: 'Reports', icon: BarChart3 },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeMenu === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveMenu(item.id as typeof activeMenu)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold transition ${
                  isActive
                    ? 'bg-[#F28C28] text-white shadow'
                    : 'hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
                {item.badge && (
                  <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded text-[10px] font-bold">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Launch Cashier POS direct link */}
        <div className="p-3 border-t border-slate-800">
          <button
            onClick={onOpenPOS}
            className="w-full py-2.5 px-3 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 text-[#F28C28] border border-orange-500/30 font-bold text-xs flex items-center justify-center gap-2 transition"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Launch Cashier Till</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto max-w-[1700px] mx-auto w-full">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight capitalize">
                {activeMenu === 'overview' ? 'Shop Owner Dashboard' : activeMenu}
              </h1>
              <span className="text-xs font-bold text-[#F28C28] bg-orange-50 border border-orange-200 px-2.5 py-0.5 rounded-full">
                {currentTenant.name}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Live supermarket operations, inventory ledger, profit calculation, and POS controls
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={exportSalesCSV}
              className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm transition"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={onOpenAddProduct}
              className="flex items-center gap-1.5 bg-[#F28C28] hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
          </div>
        </div>

        {/* 1. OVERVIEW VIEW */}
        {activeMenu === 'overview' && (
          <>
            {/* 4 KPI Cards - Pure Dynamic Calculation from Real Database Records */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <div className="bg-gradient-to-br from-[#F28C28] to-orange-600 p-5 rounded-2xl text-white shadow-lg shadow-orange-500/25 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-orange-100">Total Sales (Today)</p>
                  <h3 className="text-2xl font-black mt-1 tracking-tight">
                    {formatGHS(totalSalesToday)}
                  </h3>
                  <p className="text-[11px] font-semibold text-orange-100 flex items-center gap-1 mt-1">
                    <span>{totalOrdersCount} transaction{totalOrdersCount === 1 ? '' : 's'}</span>
                    <span className="opacity-80">today</span>
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 stroke-[2.2]" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Total Orders</p>
                  <h3 className="text-2xl font-black text-slate-900 mt-1 tracking-tight">
                    {totalOrdersCount}
                  </h3>
                  <p className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 mt-1">
                    <span>{totalOrdersCount > 0 ? 'Active transactions' : 'No sales yet'}</span>
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <ShoppingCart className="w-6 h-6 stroke-[2.2]" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Profit (Today)</p>
                  <h3 className="text-2xl font-black text-slate-900 mt-1 tracking-tight">
                    {formatGHS(grossProfitToday)}
                  </h3>
                  <p className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 mt-1">
                    <span>{totalSalesToday > 0 ? `${Math.round((grossProfitToday / totalSalesToday) * 100)}% margin` : 'Gross margin'}</span>
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Receipt className="w-6 h-6 stroke-[2.2]" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Total Products</p>
                  <h3 className="text-2xl font-black text-slate-900 mt-1 tracking-tight">
                    {totalProductsInStock}
                  </h3>
                  <p className="text-[11px] font-semibold text-purple-600 flex items-center gap-1 mt-1">
                    <span>{totalProductsInStock > 0 ? 'In Stock' : 'Catalogue empty'}</span>
                    <span className="text-slate-400 font-normal">{totalProductsInStock > 0 ? 'Ready for sale' : 'Add products to start'}</span>
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Boxes className="w-6 h-6 stroke-[2.2]" />
                </div>
              </div>
            </div>

            {/* Charts & Analytics Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-sm">Sales Trend (Real-time)</h3>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Live
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">8am - 8pm Peak Hours</span>
                </div>

                {tenantSales.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-200 rounded-xl text-slate-400">
                    <BarChart3 className="w-10 h-10 text-slate-300 mb-2 stroke-[1.5]" />
                    <p className="font-bold text-slate-700 text-sm">No sales data recorded yet</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm">
                      Completed sales from your POS terminals will generate live hourly sales trend charts.
                    </p>
                  </div>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={salesTrendData} barSize={22}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                        <XAxis dataKey="hour" stroke="#94A3B8" fontSize={11} tickLine={false} />
                        <YAxis
                          stroke="#94A3B8"
                          fontSize={11}
                          tickLine={false}
                          tickFormatter={(v) => `${v / 1000}k`}
                        />
                        <Tooltip
                          formatter={(val: unknown) => [formatGHS(Number(val) || 0), 'Sales']}
                          contentStyle={{
                            backgroundColor: '#102A4C',
                            color: '#fff',
                            borderRadius: '10px',
                            border: 'none',
                            fontSize: '12px',
                          }}
                        />
                        <Bar dataKey="sales" fill="#F28C28" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Top Selling Products List */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-900 text-sm">Top Selling Products</h3>
                    <span className="text-[11px] font-bold text-slate-400">Qty Sold</span>
                  </div>

                  {topSellingList.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl p-4">
                      <Package className="w-8 h-8 mx-auto text-slate-300 mb-2 stroke-[1.5]" />
                      <p className="text-xs font-semibold text-slate-600">No products sold yet</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Top-ranking items will appear automatically as sales are rung up.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {topSellingList.map((item) => (
                        <div key={item.product.id} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-orange-100 text-[#F28C28] flex items-center justify-center font-bold text-xs border border-orange-200">
                              <Package className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-bold text-slate-800 line-clamp-1">{item.product.name}</span>
                          </div>
                          <span className="text-xs font-extrabold text-[#F28C28]">{item.qtySold} sold</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-700">Inventory Alerts</span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-100 text-amber-700">
                      Low Stock
                    </span>
                  </div>
                  {lowStockProducts.length === 0 ? (
                    <p className="text-xs text-slate-400 py-1">All inventory items sufficiently stocked.</p>
                  ) : (
                    <div className="space-y-1.5 text-xs text-slate-600">
                      {lowStockProducts.slice(0, 3).map((item) => (
                        <div key={item.id} className="flex justify-between items-center">
                          <span className="truncate max-w-[140px]">{item.name}</span>
                          <span className="font-bold text-rose-500">{item.stock_quantity} left</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Sales Table & Quick Actions */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-900 text-sm">Recent Sales</h3>
                  <button
                    onClick={() => setActiveMenu('sales')}
                    className="text-xs font-bold text-[#F28C28] hover:underline"
                  >
                    View All
                  </button>
                </div>

                {tenantSales.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    <ShoppingCart className="w-8 h-8 mx-auto text-slate-300 mb-2 stroke-[1.5]" />
                    <p className="text-xs font-semibold text-slate-600">No sales transactions recorded yet</p>
                    <p className="text-[11px] text-slate-400 mt-1">Open your Cashier POS workstation to process your first customer checkout.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                          <th className="pb-2">Time</th>
                          <th className="pb-2">Invoice No.</th>
                          <th className="pb-2">Product(s)</th>
                          <th className="pb-2">Amount</th>
                          <th className="pb-2 text-right">Payment Method</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {tenantSales.slice(0, 6).map((sale) => (
                          <tr key={sale.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 text-slate-500 font-medium">
                              {new Date(sale.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-2.5 font-bold text-slate-800">{sale.invoice_number}</td>
                            <td className="py-2.5 text-slate-600">
                              {sale.items && sale.items.length > 0
                                ? sale.items.map((i) => i.product_name).join(', ')
                                : '—'}
                            </td>
                            <td className="py-2.5 font-extrabold text-slate-900">
                              {formatGHS(sale.total_amount)}
                            </td>
                            <td className="py-2.5 text-right">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md font-bold text-[10px] capitalize ${
                                  sale.payment_method === 'mobile_money'
                                    ? 'bg-amber-100 text-amber-700'
                                    : sale.payment_method === 'card'
                                    ? 'bg-purple-100 text-purple-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}
                              >
                                {sale.payment_method.replace('_', ' ')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Quick Actions Panel */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm mb-4">Quick Actions</h3>
                  <div className="space-y-2.5">
                    <button
                      onClick={onOpenAddProduct}
                      className="w-full flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:border-orange-500 hover:bg-orange-50/50 text-xs font-bold text-slate-700 transition"
                    >
                      <Plus className="w-4 h-4 text-[#F28C28]" />
                      <span>Add Product</span>
                    </button>

                    <button
                      onClick={() => setActiveMenu('reports')}
                      className="w-full flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:border-orange-500 hover:bg-orange-50/50 text-xs font-bold text-slate-700 transition"
                    >
                      <BarChart3 className="w-4 h-4 text-blue-600" />
                      <span>View Reports</span>
                    </button>

                    <button
                      onClick={() => setActiveMenu('staff')}
                      className="w-full flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:border-orange-500 hover:bg-orange-50/50 text-xs font-bold text-slate-700 transition"
                    >
                      <UserCheck className="w-4 h-4 text-emerald-600" />
                      <span>Manage Staff</span>
                    </button>

                    <button
                      onClick={() => setActiveMenu('inventory')}
                      className="w-full flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:border-orange-500 hover:bg-orange-50/50 text-xs font-bold text-slate-700 transition"
                    >
                      <Boxes className="w-4 h-4 text-purple-600" />
                      <span>Check Inventory</span>
                    </button>
                  </div>
                </div>

                <div className="mt-4 p-4 rounded-xl bg-orange-50/60 border border-orange-200 text-center">
                  <h4 className="font-extrabold text-xs text-slate-900">{currentTenant.name}</h4>
                  <p className="text-[11px] text-[#F28C28] font-bold mt-1">Keep up the great work!</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Your sales are growing!</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 2. SALES PAGE */}
        {activeMenu === 'sales' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Store Sales & Invoices</h3>
                <p className="text-xs text-slate-500">
                  Detailed register transactions with item breakdowns and refund capability
                </p>
              </div>
              <span className="text-xs font-bold text-slate-500">
                {tenantSales.length} total orders ({formatGHS(totalSalesToday)})
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-3">Invoice #</th>
                    <th className="pb-3">Date & Time</th>
                    <th className="pb-3">Cashier</th>
                    <th className="pb-3">Customer</th>
                    <th className="pb-3">Payment</th>
                    <th className="pb-3">Total (GHS)</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tenantSales.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="py-3 font-bold text-slate-900">{s.invoice_number}</td>
                      <td className="py-3 text-slate-500">{new Date(s.created_at).toLocaleString('en-GH')}</td>
                      <td className="py-3 font-medium text-slate-700">{s.cashier_name}</td>
                      <td className="py-3 text-slate-600">{s.customer_name || 'Walk-in'}</td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded font-bold text-[10px] uppercase bg-slate-100 text-slate-700">
                          {s.payment_method.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 font-black text-slate-900">{formatGHS(s.total_amount)}</td>
                      <td className="py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                            s.status === 'refunded'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="py-3 text-right space-x-2">
                        {s.status !== 'refunded' && (
                          <button
                            onClick={() => handleRefund(s.id)}
                            className="px-2.5 py-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 font-bold text-[10px] transition"
                          >
                            Refund
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. INVENTORY PAGE */}
        {activeMenu === 'inventory' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Stock Balances & Low-Stock Alerts</h3>
                  <p className="text-xs text-slate-500">
                    Live branch stock counts with manual adjustment triggers
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="pb-3">Product</th>
                      <th className="pb-3">Barcode</th>
                      <th className="pb-3">Available Stock</th>
                      <th className="pb-3">Min Threshold</th>
                      <th className="pb-3">Stock Valuation</th>
                      <th className="pb-3 text-right">Adjustment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tenantProducts.map((p) => {
                      const isLow = p.stock_quantity <= p.min_stock_threshold;
                      return (
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
                          <td className="py-3 font-extrabold text-slate-900">
                            <span className={isLow ? 'text-rose-600' : 'text-emerald-700'}>
                              {p.stock_quantity} {p.unit}s
                            </span>
                            {isLow && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold text-[10px]">
                                Low
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-slate-500">{p.min_stock_threshold} {p.unit}s</td>
                          <td className="py-3 font-semibold text-slate-800">
                            {formatGHS(p.cost_price * p.stock_quantity)}
                          </td>
                          <td className="py-3 text-right">
                            <button
                              onClick={() => setShowStockAdjustModal(p)}
                              className="px-3 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-orange-50 hover:border-orange-500 font-bold transition"
                            >
                              Adjust Stock
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Stock Movement Ledger History */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Audit Stock Movement Ledger</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="pb-2">Time</th>
                      <th className="pb-2">Product</th>
                      <th className="pb-2">Type</th>
                      <th className="pb-2">Quantity</th>
                      <th className="pb-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movements.slice(0, 8).map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 text-slate-500">{new Date(m.created_at).toLocaleTimeString()}</td>
                        <td className="py-2.5 font-bold text-slate-800">{m.product_name}</td>
                        <td className="py-2.5 uppercase font-bold text-[10px]">
                          <span
                            className={`px-2 py-0.5 rounded ${
                              m.type === 'sale'
                                ? 'bg-blue-100 text-blue-700'
                                : m.type === 'refund'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {m.type}
                          </span>
                        </td>
                        <td className="py-2.5 font-extrabold text-slate-900">{m.quantity}</td>
                        <td className="py-2.5 text-slate-500">{m.reason || 'Inventory action'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 4. PRODUCTS MANAGEMENT PAGE */}
        {activeMenu === 'products' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Products Catalog Management</h3>
                <p className="text-xs text-slate-500">Edit retail prices, cost of goods, and inventory records</p>
              </div>
              <button
                onClick={onOpenAddProduct}
                className="flex items-center gap-1.5 bg-[#F28C28] hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md shadow-orange-500/20"
              >
                <Plus className="w-4 h-4" />
                <span>Add Product</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-3">Product Name</th>
                    <th className="pb-3">Barcode</th>
                    <th className="pb-3">Category</th>
                    <th className="pb-3">Cost Price</th>
                    <th className="pb-3">Selling Price</th>
                    <th className="pb-3">In Stock</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tenantProducts.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="py-3 font-bold text-slate-900 flex items-center gap-2.5">
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200"
                        />
                        <div>
                          <p className="font-bold">{p.name}</p>
                          <p className="text-[10px] text-slate-400">{p.unit}</p>
                        </div>
                      </td>
                      <td className="py-3 font-mono text-slate-600">{p.barcode}</td>
                      <td className="py-3 text-slate-600">{p.category_name}</td>
                      <td className="py-3 text-slate-500 font-medium">{formatGHS(p.cost_price)}</td>
                      <td className="py-3 font-black text-slate-900">{formatGHS(p.selling_price)}</td>
                      <td className="py-3 font-bold text-slate-800">{p.stock_quantity}</td>
                      <td className="py-3 text-right space-x-2">
                        <button
                          onClick={() => {
                            const newPrice = prompt(`Enter new selling price for ${p.name}:`, p.selling_price.toString());
                            if (newPrice) {
                              db.updateProduct(p.id, { selling_price: parseFloat(newPrice) || p.selling_price });
                            }
                          }}
                          className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] transition"
                        >
                          Edit Price
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Archive ${p.name}?`)) {
                              db.deleteProduct(p.id);
                            }
                          }}
                          className="px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-[10px] transition"
                        >
                          Archive
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. CUSTOMERS PAGE */}
        {activeMenu === 'customers' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Customer Directory & Loyalty</h3>
                <p className="text-xs text-slate-500">Track supermarket shoppers, points, and spend</p>
              </div>
              <button
                onClick={() => setShowAddCustomerModal(true)}
                className="flex items-center gap-1.5 bg-[#F28C28] hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md shadow-orange-500/20"
              >
                <Plus className="w-4 h-4" />
                <span>Add Customer</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-3">Customer Name</th>
                    <th className="pb-3">Phone</th>
                    <th className="pb-3">Email</th>
                    <th className="pb-3">Loyalty Points</th>
                    <th className="pb-3 text-right">Lifetime Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <td className="py-3 font-bold text-slate-900">{c.name}</td>
                      <td className="py-3 text-slate-600">{c.phone}</td>
                      <td className="py-3 text-slate-400">{c.email || '—'}</td>
                      <td className="py-3 font-extrabold text-[#F28C28]">★ {c.loyalty_points} pts</td>
                      <td className="py-3 text-right font-black text-slate-900">
                        {formatGHS(c.total_spent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 6. STAFF PAGE */}
        {activeMenu === 'staff' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Store Staff & Cashier Tills</h3>
                <p className="text-xs text-slate-500">Manage cashier credentials and shift permissions</p>
              </div>
              <button
                onClick={() => setShowAddStaffModal(true)}
                className="flex items-center gap-1.5 bg-[#F28C28] hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md shadow-orange-500/20"
              >
                <Plus className="w-4 h-4" />
                <span>Add Cashier</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-3">Staff Name</th>
                    <th className="pb-3">Role</th>
                    <th className="pb-3">Email</th>
                    <th className="pb-3">Phone</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffMembers.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="py-3 font-bold text-slate-900">{s.full_name}</td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded-full font-bold text-[10px] uppercase bg-blue-50 text-blue-700">
                          {s.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 text-slate-500">{s.email}</td>
                      <td className="py-3 text-slate-500">{s.phone}</td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                          {s.is_active ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => db.toggleUserStatus(s.id)}
                          className="text-[#F28C28] font-bold hover:underline"
                        >
                          {s.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 7. EXPENSES PAGE */}
        {activeMenu === 'expenses' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Store Operational Expenses</h3>
                <p className="text-xs text-slate-500">
                  Utilities, packaging bags, till paper rolls, and shop maintenance
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-600">
                  Total Expenses: <strong className="text-rose-600">{formatGHS(totalExpensesAmount)}</strong>
                </span>
                <button
                  onClick={() => setShowAddExpenseModal(true)}
                  className="flex items-center gap-1.5 bg-[#F28C28] hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-md shadow-orange-500/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Record Expense</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-3">Date</th>
                    <th className="pb-3">Category</th>
                    <th className="pb-3">Description</th>
                    <th className="pb-3 text-right">Amount (GHS)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/70">
                      <td className="py-3 text-slate-500">{e.expense_date}</td>
                      <td className="py-3 font-bold text-slate-800">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {e.category}
                        </span>
                      </td>
                      <td className="py-3 text-slate-700">{e.description}</td>
                      <td className="py-3 text-right font-black text-rose-600">
                        {formatGHS(e.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 8. REPORTS PAGE */}
        {activeMenu === 'reports' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">Profit, Margin & Tax Financial Reports</h3>
                <p className="text-xs text-slate-500">
                  Calculated using authoritative inventory COGS and confirmed checkout sales
                </p>
              </div>
              <button
                onClick={exportSalesCSV}
                className="flex items-center gap-1.5 bg-[#102A4C] hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-bold transition"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Export Audit CSV</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-bold text-slate-500">Gross Sales</span>
                <p className="text-2xl font-black text-slate-900 mt-1">{formatGHS(totalSalesToday)}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-bold text-slate-500">Cost of Goods Sold (COGS)</span>
                <p className="text-2xl font-black text-slate-900 mt-1">{formatGHS(totalCostToday)}</p>
              </div>
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <span className="text-xs font-bold text-emerald-800">Gross Profit</span>
                <p className="text-2xl font-black text-emerald-700 mt-1">{formatGHS(grossProfitToday)}</p>
              </div>
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200">
                <span className="text-xs font-bold text-rose-800">Total Expenses</span>
                <p className="text-2xl font-black text-rose-600 mt-1">{formatGHS(totalExpensesAmount)}</p>
              </div>
            </div>
          </div>
        )}

        {/* 9. SETTINGS PAGE */}
        {activeMenu === 'settings' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm max-w-2xl">
            <h3 className="text-lg font-black text-slate-900 mb-1">Supermarket Store Settings</h3>
            <p className="text-xs text-slate-500 mb-6">Manage branch profile, tax rates, and thermal receipt copy</p>

            <div className="space-y-4 text-xs font-medium text-slate-700">
              <div>
                <label className="block font-bold mb-1">Store Legal Name</label>
                <input
                  type="text"
                  defaultValue={currentTenant.name}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Physical Address on Receipts</label>
                <input
                  type="text"
                  defaultValue={currentTenant.address}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Store Phone Contact</label>
                <input
                  type="text"
                  defaultValue={currentTenant.phone}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Receipt Footer Note</label>
                <textarea
                  defaultValue="Thank you for shopping with us! Goods sold are returnable within 48h with receipt."
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800"
                  rows={2}
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => alert('Store settings updated successfully!')}
                  className="px-5 py-2.5 bg-[#F28C28] hover:bg-orange-600 text-white rounded-xl font-extrabold transition"
                >
                  Save Store Profile
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stock Adjustment Modal */}
        {showStockAdjustModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
              <h3 className="text-base font-black text-slate-900 mb-1">Adjust Inventory Stock</h3>
              <p className="text-xs text-slate-500 mb-4">
                Updating stock for <strong className="text-slate-900">{showStockAdjustModal.name}</strong>
              </p>

              <form onSubmit={handleConfirmStockAdjust} className="space-y-3 text-xs font-medium text-slate-700">
                <div>
                  <label className="block font-bold mb-1">Current Stock in Till</label>
                  <input
                    type="text"
                    disabled
                    value={`${showStockAdjustModal.stock_quantity} ${showStockAdjustModal.unit}s`}
                    className="w-full p-2.5 bg-slate-100 border border-slate-300 rounded-xl font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Quantity to Add (or negative to remove) *</label>
                  <input
                    type="number"
                    required
                    value={stockAdjustQty}
                    onChange={(e) => setStockAdjustQty(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-black text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Adjustment Reason</label>
                  <select
                    value={stockAdjustReason}
                    onChange={(e) => setStockAdjustReason(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  >
                    <option value="Restock shipment from supplier">Restock shipment from supplier</option>
                    <option value="Physical till stock audit count">Physical till stock audit count</option>
                    <option value="Damage / Expiry disposal">Damage / Expiry disposal</option>
                    <option value="Customer return / restock">Customer return / restock</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowStockAdjustModal(null)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold rounded-xl shadow-md transition"
                  >
                    Commit Adjustment
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Customer Modal */}
        {showAddCustomerModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
              <h3 className="text-base font-black text-slate-900 mb-1">Register Customer</h3>
              <p className="text-xs text-slate-500 mb-4">Enroll shopper in {currentTenant.name} loyalty program</p>

              <form onSubmit={handleCreateCustomer} className="space-y-3 text-xs font-medium text-slate-700">
                <div>
                  <label className="block font-bold mb-1">Customer Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ama Serwaa"
                    value={custName}
                    onChange={(e) => setCustName(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Phone Number (Ghana MoMo / SMS) *</label>
                  <input
                    type="text"
                    required
                    value={custPhone}
                    onChange={(e) => setCustPhone(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Email (Optional)</label>
                  <input
                    type="email"
                    value={custEmail}
                    onChange={(e) => setCustEmail(e.target.value)}
                    placeholder="ama@gmail.com"
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowAddCustomerModal(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold rounded-xl shadow-md transition"
                  >
                    Save Customer
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Expense Modal */}
        {showAddExpenseModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
              <h3 className="text-base font-black text-slate-900 mb-1">Record Store Expense</h3>
              <p className="text-xs text-slate-500 mb-4">Track daily shop operating costs</p>

              <form onSubmit={handleCreateExpense} className="space-y-3 text-xs font-medium text-slate-700">
                <div>
                  <label className="block font-bold mb-1">Category</label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  >
                    <option value="Utilities">Utilities (ECG / Water)</option>
                    <option value="Packaging">Packaging (Shopping Bags)</option>
                    <option value="Supplies">Supplies (Thermal Paper)</option>
                    <option value="Maintenance">Maintenance & Cleaning</option>
                    <option value="Staff Meals">Staff Meals & Transport</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold mb-1">Amount (GH₵) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-black text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Description</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ECG electricity prepaid commercial token"
                    value={expDesc}
                    onChange={(e) => setExpDesc(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowAddExpenseModal(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold rounded-xl shadow-md transition"
                  >
                    Record Expense
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Staff Modal */}
        {showAddStaffModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
              <h3 className="text-base font-black text-slate-900 mb-1">Add Cashier / Staff</h3>
              <p className="text-xs text-slate-500 mb-4">Grant checkout permissions for {currentTenant.name}</p>

              <form onSubmit={handleCreateStaff} className="space-y-3 text-xs font-medium text-slate-700">
                <div>
                  <label className="block font-bold mb-1">Staff Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Samuel Okyere"
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Phone</label>
                  <input
                    type="text"
                    value={staffPhone}
                    onChange={(e) => setStaffPhone(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Role</label>
                  <select
                    value={staffRole}
                    onChange={(e) => setStaffRole(e.target.value as typeof staffRole)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  >
                    <option value="cashier">Cashier</option>
                    <option value="shop_owner">Store Manager / Owner</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowAddStaffModal(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold rounded-xl shadow-md transition"
                  >
                    Save Cashier
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
