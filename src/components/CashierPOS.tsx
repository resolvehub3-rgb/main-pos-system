import React, { useState, useRef } from 'react';
import {
  Search,
  Barcode,
  Plus,
  Minus,
  Trash2,
  Printer,
  RotateCcw,
  CreditCard,
  Phone,
  Banknote,
  CheckCircle2,
  Clock,
  Sparkles,
  ShoppingBag,
  Package,
  Boxes,
  DollarSign,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Monitor,
  PauseCircle,
  PlayCircle,
  Percent,
  Check,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { formatGHS, calculateCartTotals, calculateCashChange } from '../lib/money';
import { playScannerBeep, playSaleChime } from '../lib/sound';
import { useTerminalSettings } from '../lib/terminalSettings';
import { ReceiptPrinterModal } from './ReceiptPrinterModal';
import { Product, CartItem, Sale, Tenant, CashRegisterShift, ParkedCart } from '../types';
import { db } from '../lib/supabaseClient';

interface CashierPOSProps {
  currentTenant: Tenant;
  products: Product[];
  activeShift?: CashRegisterShift;
  onCompleteSale: (saleData: {
    payment_method: Sale['payment_method'];
    payment_details?: Sale['payment_details'];
    items: { productId: string; quantity: number; discountPercent?: number }[];
  }) => Sale;
  onPrintLastReceipt: (sale: Sale, opts?: { autoPrint?: boolean }) => void;
  onOpenCustomerDisplay: () => void;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
}

export const CashierPOS: React.FC<CashierPOSProps> = ({
  currentTenant,
  products,
  activeShift,
  onCompleteSale,
  onPrintLastReceipt,
  onOpenCustomerDisplay,
  cart,
  setCart,
}) => {
  // Navigation Tabs for Cashier
  const [activeTab, setActiveTab] = useState<'pos' | 'history' | 'checker' | 'shift'>('pos');

  // POS State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [activePaymentModal, setActivePaymentModal] = useState<'cash' | 'momo' | 'card' | 'split' | null>(null);

  // Cash tendered state
  const [cashTendered, setCashTendered] = useState<number>(0);

  // Mobile money state
  const [momoNetwork, setMomoNetwork] = useState<string>('MTN Mobile Money');
  const [momoPhone, setMomoPhone] = useState<string>('024 123 4567');
  const [momoReference, setMomoReference] = useState<string>('MM-' + Math.floor(100000 + Math.random() * 900000));

  // Split payment state
  const [splitCashAmount, setSplitCashAmount] = useState<number>(0);
  const [splitMomoAmount, setSplitMomoAmount] = useState<number>(0);

  // Discount modal state
  const [discountItem, setDiscountItem] = useState<CartItem | null>(null);
  const [discountPercentInput, setDiscountPercentInput] = useState<number>(5);

  // Parked carts modal
  const [showParkedModal, setShowParkedModal] = useState(false);
  const [parkNote, setParkNote] = useState('');

  // Cash movement modal (Cash In / Float vs Cash Out / Drop)
  const [showCashMovementModal, setShowCashMovementModal] = useState<'cash_in' | 'cash_out' | null>(null);
  const [movementAmount, setMovementAmount] = useState<string>('50.00');
  const [movementReason, setMovementReason] = useState<string>('Change float replenishment');

  // Shift closing modal
  const [showCloseShiftModal, setShowCloseShiftModal] = useState(false);
  const [countedCash, setCountedCash] = useState<string>('');
  const [shiftCloseNotes, setShiftCloseNotes] = useState('');

  // Price checker state
  const [checkerQuery, setCheckerQuery] = useState('');
  const [checkedProduct, setCheckedProduct] = useState<Product | null>(null);

  // Terminal preferences are owned by the Shop Owner dashboard and read live here.
  const terminalSettings = useTerminalSettings();
  const beepEnabled = terminalSettings.beep_enabled;
  const autoPrintEnabled = terminalSettings.auto_print_receipt;

  // Sale shown in the automatic animated receipt-printing display
  const [printingSale, setPrintingSale] = useState<Sale | null>(null);

  // Scanner autofocus input ref
  const searchInputRef = useRef<HTMLInputElement>(null);
  const checkerInputRef = useRef<HTMLInputElement>(null);

  // Categories list — derived live from the shop's managed categories
  // (cashiers can FILTER by category but cannot create or edit categories)
  const categories = React.useMemo(() => {
    const names = new Set<string>();
    for (const c of db.getCategories(currentTenant.id, { activeOnly: true })) {
      names.add(c.name);
    }
    for (const p of products) {
      if (p.category_name) names.add(p.category_name);
    }
    return ['All', ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  }, [currentTenant.id, products]);

  // Dynamic calculations from DB
  const sales = db.getSales(currentTenant.id);
  const parkedCarts = db.getParkedCarts(currentTenant.id);
  const currentShift = activeShift || db.getActiveShift(currentTenant.id);
  const cashMovements = db.getCashMovements(currentShift?.id);

  // Filter products by search and category
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcode.includes(searchQuery.trim());
    const matchesCategory =
      selectedCategory === 'All' || p.category_name === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Calculate totals
  const cartCalculations = cart.map((item) => ({
    price: item.product.selling_price,
    quantity: item.quantity,
    discountPercent: item.discount_percent,
  }));
  const totals = calculateCartTotals(cartCalculations);

  // Barcode scanner keydown listener (Enter triggers scan)
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const matched = products.find(
      (p) =>
        p.barcode === barcodeInput.trim() ||
        p.sku.toLowerCase() === barcodeInput.trim().toLowerCase()
    );

    if (matched) {
      if (beepEnabled) playScannerBeep();
      addToCart(matched);
      setBarcodeInput('');
    } else {
      alert(`Product with barcode "${barcodeInput}" not found in ${currentTenant.name}.`);
    }
  };

  // Add item to cart
  const addToCart = (product: Product) => {
    if (product.stock_quantity <= 0) {
      alert(`${product.name} is out of stock!`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock_quantity) {
          alert(`Cannot add more. Only ${product.stock_quantity} available in stock.`);
          return prev;
        }
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1, discount_percent: 0 }];
    });
  };

  // Modify quantity
  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta;
            if (newQty > item.product.stock_quantity) {
              alert(`Only ${item.product.stock_quantity} available in stock.`);
              return item;
            }
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  // Apply discount to specific line
  const handleApplyLineDiscount = (percent: number) => {
    if (!discountItem) return;
    setCart((prev) =>
      prev.map((c) =>
        c.product.id === discountItem.product.id
          ? { ...c, discount_percent: Math.min(100, Math.max(0, percent)) }
          : c
      )
    );
    setDiscountItem(null);
  };

  // Remove item
  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  // Clear cart
  const clearCart = () => {
    if (cart.length > 0 && confirm('Are you sure you want to clear current sale?')) {
      setCart([]);
    }
  };

  // Park current sale (hold cart)
  const handleParkCart = () => {
    if (cart.length === 0) return;
    db.parkCart(
      currentTenant.id,
      cart,
      totals.total,
      `Shopper Till #01`,
      parkNote || 'Parked by Cashier'
    );
    setCart([]);
    setParkNote('');
    alert('Sale successfully parked! You can resume it anytime.');
  };

  // Resume parked sale
  const handleResumeParkedCart = (parked: ParkedCart) => {
    if (cart.length > 0) {
      if (!confirm('Active cart has items. Replacing current cart with parked sale?')) {
        return;
      }
    }
    setCart(parked.items);
    db.deleteParkedCart(parked.id);
    setShowParkedModal(false);
    setActiveTab('pos');
  };

  // Finalize Sale
  const handleFinalizeSale = (
    method: Sale['payment_method'],
    details?: Sale['payment_details']
  ) => {
    if (cart.length === 0) return;

    try {
      const sale = onCompleteSale({
        payment_method: method,
        payment_details: details,
        items: cart.map((c) => ({
          productId: c.product.id,
          quantity: c.quantity,
          discountPercent: c.discount_percent,
        })),
      });

      // Play chime & confetti
      if (beepEnabled) playSaleChime();
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.8 },
      });

      // Clear cart & close modals
      setCart([]);
      setActivePaymentModal(null);
      setCashTendered(0);

      // Animated printing display: it prints and dismisses itself automatically,
      // so the cashier never has to click Done or Print Thermal.
      // Owner preference honoured: with auto-print off, the receipt preview is
      // shown instead so the cashier can decide to print or not.
      if (autoPrintEnabled) {
        setPrintingSale(sale);
      } else {
        onPrintLastReceipt(sale);
      }
    } catch (err: unknown) {
      alert(`Checkout failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Handle price checker search
  const handleCheckerSearch = (term: string) => {
    setCheckerQuery(term);
    if (!term.trim()) {
      setCheckedProduct(null);
      return;
    }
    const match = products.find(
      (p) =>
        p.barcode === term.trim() ||
        p.sku.toLowerCase() === term.trim().toLowerCase() ||
        p.name.toLowerCase().includes(term.toLowerCase())
    );
    if (match) {
      setCheckedProduct(match);
      if (beepEnabled) playScannerBeep();
    } else {
      setCheckedProduct(null);
    }
  };

  // Handle cash drawer movement
  const handleRecordCashMovement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showCashMovementModal || !currentShift) return;
    const amount = parseFloat(movementAmount) || 0;
    if (amount <= 0) return;

    db.recordCashMovement(
      currentTenant.id,
      currentShift.id,
      showCashMovementModal,
      amount,
      movementReason
    );
    setShowCashMovementModal(null);
    setMovementAmount('50.00');
  };

  // Handle shift close
  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShift) return;
    const count = parseFloat(countedCash) || 0;
    db.closeShift(currentShift.id, count, shiftCloseNotes);
    setShowCloseShiftModal(false);
    alert('Shift closed successfully. Z-Report generated.');
  };

  // Compute cash change
  const cashChange = calculateCashChange(totals.total, cashTendered);

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-4rem)] bg-[#F5F7FA] overflow-hidden font-['Montserrat',sans-serif]">
      {/* Mobile Navigation Header Tabs */}
      <div className="md:hidden bg-[#102A4C] text-white p-2 flex items-center justify-between overflow-x-auto gap-2 border-b border-slate-700">
        {[
          { id: 'pos', label: 'Till POS', icon: ShoppingBag },
          { id: 'history', label: 'Sales History', icon: Clock, count: sales.length },
          { id: 'checker', label: 'Price Checker', icon: Barcode },
          { id: 'shift', label: 'Cash Drawer', icon: DollarSign },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                isActive ? 'bg-[#F28C28] text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-900 text-slate-300">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Desktop Left Navigation Sidebar */}
      <aside className="w-60 bg-[#102A4C] text-slate-300 flex-col justify-between border-r border-slate-800 flex-shrink-0 hidden md:flex">
        <div>
          <div className="p-4 border-b border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Cashier Till #01
                </span>
              </div>
              <span className="text-[10px] font-bold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                Live
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 truncate">{currentTenant.name}</p>
          </div>

          <nav className="p-3 space-y-1.5">
            {[
              { id: 'pos', label: 'POS Checkout', icon: ShoppingBag, desc: 'Barcode Till' },
              {
                id: 'history',
                label: 'Sales History',
                icon: Clock,
                desc: 'Invoices & Reprints',
                badge: sales.length,
              },
              { id: 'checker', label: 'Price Checker', icon: Barcode, desc: 'Barcode Scan' },
              { id: 'shift', label: 'Shift & Cash Drawer', icon: DollarSign, desc: 'Float & Totals' },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition ${
                    isActive
                      ? 'bg-[#F28C28] text-white shadow-md shadow-orange-500/25'
                      : 'hover:bg-slate-800/80 hover:text-white text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4" />
                    <div className="text-left">
                      <p className="leading-none">{tab.label}</p>
                      <p
                        className={`text-[10px] mt-0.5 font-normal ${
                          isActive ? 'text-orange-100' : 'text-slate-400'
                        }`}
                      >
                        {tab.desc}
                      </p>
                    </div>
                  </div>
                  {tab.badge !== undefined && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Current Cashier info footer & Customer Display shortcut */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/60 space-y-2.5">
          <button
            onClick={onOpenCustomerDisplay}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition"
          >
            <Monitor className="w-3.5 h-3.5 text-[#F28C28]" />
            <span>Dual Customer Screen</span>
          </button>

          <div className="flex items-center gap-2.5 pt-1">
            <div className="w-8 h-8 rounded-full bg-orange-500/20 text-[#F28C28] font-black text-xs flex items-center justify-center">
              CK
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-white truncate">Cashier Kofi</p>
              <p className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Shift Open • Ready
              </p>
            </div>
          </div>

          {/* Printer & audio are configured by the shop owner only */}
          <div className="flex items-center gap-2 pt-1.5 border-t border-slate-800 text-[10px] text-slate-400">
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Printer &amp; audio set by the store owner</span>
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 1. POS CHECKOUT VIEW */}
      {/* ========================================================================= */}
      {activeTab === 'pos' && (
        <>
          {/* Center Product Catalog Area */}
          <section className="flex-1 flex flex-col min-w-0 bg-[#F5F7FA] overflow-hidden">
            {/* Top Bar with Barcode Scanner & Search */}
            <div className="p-3 sm:p-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <form
                onSubmit={handleBarcodeSubmit}
                className="flex-1 max-w-xl relative flex items-center"
              >
                <Search className="w-4 h-4 absolute left-3.5 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Scan barcode (e.g. 8998866200234) or search product..."
                  value={barcodeInput || searchQuery}
                  onChange={(e) => {
                    setBarcodeInput(e.target.value);
                    setSearchQuery(e.target.value);
                  }}
                  className="w-full pl-10 pr-20 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#F28C28] focus:bg-white transition"
                />
                <button
                  type="submit"
                  className="absolute right-1.5 top-1.5 bottom-1.5 px-3 bg-[#F28C28] hover:bg-orange-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <Barcode className="w-4 h-4" />
                  <span className="hidden sm:inline">Scan</span>
                </button>
              </form>

              {/* Parked Carts and Shortcuts */}
              <div className="flex items-center gap-2">
                {parkedCarts.length > 0 && (
                  <button
                    onClick={() => setShowParkedModal(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 border border-amber-300 rounded-xl text-xs font-bold transition"
                  >
                    <PauseCircle className="w-4 h-4 text-amber-600" />
                    <span>Parked Sales ({parkedCarts.length})</span>
                  </button>
                )}

                <button
                  onClick={onOpenCustomerDisplay}
                  className="hidden xl:flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
                >
                  <Monitor className="w-3.5 h-3.5 text-slate-500" />
                  <span>Customer View</span>
                </button>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="px-4 py-2 bg-white/70 border-b border-slate-200/80 overflow-x-auto flex items-center gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                    selectedCategory === cat
                      ? 'bg-[#102A4C] text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Products Grid matching the 9 items in screenshot */}
            <div className="flex-1 p-3 sm:p-4 overflow-y-auto">
              {filteredProducts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <ShoppingBag className="w-12 h-12 text-slate-300 mb-3" />
                  <h3 className="font-bold text-slate-700 text-sm">No products found</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    Try scanning another barcode or clearing your search filter.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
                  {filteredProducts.map((product) => {
                    const isInCart = cart.find((c) => c.product.id === product.id);
                    return (
                      <div
                        key={product.id}
                        onClick={() => {
                          if (beepEnabled) playScannerBeep();
                          addToCart(product);
                        }}
                        className="group bg-white rounded-2xl border border-slate-200/90 hover:border-orange-500 hover:shadow-md p-3 flex flex-col justify-between cursor-pointer transition transform active:scale-[0.98]"
                      >
                        <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-slate-50 mb-2.5">
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            loading="lazy"
                          />
                          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-white/90 backdrop-blur-sm text-[10px] font-bold text-slate-700 border border-slate-200">
                            {product.stock_quantity} left
                          </span>
                          {isInCart && (
                            <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-[#F28C28] text-white text-[11px] font-extrabold shadow">
                              {isInCart.quantity} in cart
                            </span>
                          )}
                        </div>

                        <div>
                          <h4 className="font-bold text-xs text-slate-900 line-clamp-1 group-hover:text-[#F28C28] transition">
                            {product.name}
                          </h4>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs font-black text-slate-900">
                              {formatGHS(product.selling_price)}
                            </span>
                            <span className="text-[10px] text-slate-400">{product.unit}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Right Cart & Payment Panel */}
          <aside className="w-full md:w-80 lg:w-96 bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col justify-between shadow-xl z-20">
            {/* Cart Header */}
            <div className="p-3.5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-extrabold text-sm text-slate-900">
                  Current Sale ({cart.reduce((acc, c) => acc + c.quantity, 0)})
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {cart.length > 0 && (
                  <>
                    <button
                      onClick={handleParkCart}
                      title="Park / Hold Sale"
                      className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200"
                    >
                      <PauseCircle className="w-3.5 h-3.5" />
                      <span>Park</span>
                    </button>

                    <button
                      onClick={clearCart}
                      title="Clear cart"
                      className="text-xs font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Clear</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 max-h-[35vh] md:max-h-none">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                  <ShoppingBag className="w-12 h-12 stroke-[1.5] mb-2 opacity-40 text-[#F28C28]" />
                  <p className="text-xs font-bold text-slate-600">Cart is empty</p>
                  <p className="text-[11px] mt-0.5">Scan a barcode or tap items to ring up sale</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.product.id}
                    className="flex items-center justify-between gap-2.5 p-2 rounded-xl border border-slate-100 hover:border-slate-200 bg-slate-50/60"
                  >
                    <img
                      src={item.product.image_url}
                      alt={item.product.name}
                      className="w-10 h-10 rounded-lg object-cover border border-slate-200 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 truncate">
                        {item.product.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 font-medium">
                        {formatGHS(item.product.selling_price)}
                        {item.discount_percent > 0 && (
                          <span className="ml-1 text-emerald-600 font-bold">
                            (-{item.discount_percent}%)
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Qty +/- Controls */}
                    <div className="flex items-center gap-0.5 bg-white border border-slate-200 rounded-lg p-0.5">
                      <button
                        onClick={() => updateQuantity(item.product.id, -1)}
                        className="w-6 h-6 rounded flex items-center justify-center hover:bg-slate-100 text-slate-600"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center text-xs font-extrabold text-slate-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.product.id, 1)}
                        className="w-6 h-6 rounded flex items-center justify-center hover:bg-slate-100 text-slate-600"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="text-right flex flex-col items-end">
                      <p className="text-xs font-extrabold text-slate-900">
                        {formatGHS(
                          item.product.selling_price *
                            item.quantity *
                            (1 - item.discount_percent / 100)
                        )}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <button
                          onClick={() => {
                            setDiscountItem(item);
                            setDiscountPercentInput(item.discount_percent || 5);
                          }}
                          className="text-[10px] font-bold text-slate-400 hover:text-emerald-600"
                          title="Apply discount"
                        >
                          %
                        </button>
                        <button
                          onClick={() => removeFromCart(item.product.id)}
                          className="text-slate-400 hover:text-rose-500 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Totals & Payment Actions Area */}
            <div className="p-3.5 border-t border-slate-200 bg-slate-50/90">
              <div className="space-y-1 text-xs text-slate-600 mb-3">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-semibold text-slate-900">{formatGHS(totals.subtotal)}</span>
                </div>
                {totals.discountTotal > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Discounts</span>
                    <span>-{formatGHS(totals.discountTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-black text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>Total Due</span>
                  <span className="text-[#F28C28]">{formatGHS(totals.total)}</span>
                </div>
              </div>

              {/* Payment Method Action Buttons matching screenshot */}
              <div className="grid grid-cols-3 gap-2 mb-2.5">
                <button
                  disabled={cart.length === 0}
                  onClick={() => {
                    setCashTendered(Math.ceil(totals.total));
                    setActivePaymentModal('cash');
                  }}
                  className="py-2 px-1.5 rounded-xl bg-[#F28C28] hover:bg-orange-600 disabled:opacity-40 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition"
                >
                  <Banknote className="w-4 h-4" />
                  <span>Cash</span>
                </button>

                <button
                  disabled={cart.length === 0}
                  onClick={() => setActivePaymentModal('momo')}
                  className="py-2 px-1.5 rounded-xl bg-[#102A4C] hover:bg-slate-800 disabled:opacity-40 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition"
                >
                  <Phone className="w-4 h-4" />
                  <span>MoMo</span>
                </button>

                <button
                  disabled={cart.length === 0}
                  onClick={() => setActivePaymentModal('card')}
                  className="py-2 px-1.5 rounded-xl bg-[#102A4C] hover:bg-slate-800 disabled:opacity-40 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Card</span>
                </button>
              </div>

              {/* Big Orange "Print Receipt" Checkout Action */}
              <button
                disabled={cart.length === 0}
                onClick={() =>
                  handleFinalizeSale('cash', { cash_tendered: totals.total, change_due: 0 })
                }
                className="w-full py-2.5 rounded-xl bg-[#F28C28] hover:bg-orange-600 disabled:opacity-40 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30 transition transform active:scale-[0.99]"
              >
                <Printer className="w-4 h-4" />
                <span>Instant Checkout & Print</span>
              </button>
            </div>
          </aside>
        </>
      )}

      {/* ========================================================================= */}
      {/* 2. SALES HISTORY VIEW */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <section className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto bg-white">
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">Cashier Sales Ledger & Receipts</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  View recent orders at Till #01, reprint receipts, and process customer refunds
                </p>
              </div>
              <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                {sales.length} Total Store Invoices
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                    <th className="pb-3">Invoice #</th>
                    <th className="pb-3">Time</th>
                    <th className="pb-3">Customer</th>
                    <th className="pb-3">Items</th>
                    <th className="pb-3">Payment</th>
                    <th className="pb-3">Total Amount</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-slate-50/70">
                      <td className="py-3 font-bold text-slate-900">{sale.invoice_number}</td>
                      <td className="py-3 text-slate-500">
                        {new Date(sale.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 text-slate-700 font-medium">
                        {sale.customer_name || 'Walk-in Shopper'}
                      </td>
                      <td className="py-3 text-slate-600">
                        {sale.items?.reduce((acc, i) => acc + i.quantity, 0) || 1} items
                      </td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded font-bold text-[10px] uppercase bg-slate-100 text-slate-700">
                          {sale.payment_method.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 font-black text-slate-900">
                        {formatGHS(sale.total_amount)}
                      </td>
                      <td className="py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                            sale.status === 'refunded'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {sale.status}
                        </span>
                      </td>
                      <td className="py-3 text-right space-x-2">
                        <button
                          onClick={() => onPrintLastReceipt(sale)}
                          className="px-2.5 py-1 rounded bg-[#102A4C] hover:bg-slate-800 text-white font-bold text-[10px] transition"
                        >
                          Reprint
                        </button>
                        {sale.status !== 'refunded' && (
                          <button
                            onClick={() => {
                              if (confirm(`Process customer refund for ${sale.invoice_number}?`)) {
                                db.refundSale(sale.id, 'Cashier return approved');
                              }
                            }}
                            className="px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-[10px] transition"
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
        </section>
      )}

      {/* ========================================================================= */}
      {/* 3. PRICE & BARCODE CHECKER VIEW */}
      {/* ========================================================================= */}
      {activeTab === 'checker' && (
        <section className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto bg-slate-50">
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center">
              <div className="w-12 h-12 rounded-2xl bg-orange-500/10 text-[#F28C28] flex items-center justify-center mx-auto mb-3">
                <Barcode className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-black text-slate-900">Retail Price & Stock Checker</h2>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Scan any barcode or type a product name to verify shelf pricing, unit packaging, and
                current stock levels without altering the customer's cart.
              </p>

              <div className="mt-6 relative max-w-lg mx-auto">
                <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  ref={checkerInputRef}
                  type="text"
                  autoFocus
                  placeholder="Scan or enter barcode (e.g. 8998866200234)..."
                  value={checkerQuery}
                  onChange={(e) => handleCheckerSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#F28C28] focus:bg-white transition"
                />
              </div>
            </div>

            {/* Checked Product Card */}
            {checkedProduct ? (
              <div className="bg-white p-6 rounded-2xl border-2 border-orange-500/40 shadow-md">
                <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
                  <img
                    src={checkedProduct.image_url}
                    alt={checkedProduct.name}
                    className="w-32 h-32 rounded-xl object-cover border border-slate-200"
                  />
                  <div className="flex-1 space-y-2 text-center sm:text-left">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-[#F28C28]">
                      {checkedProduct.category_name}
                    </span>
                    <h3 className="text-xl font-black text-slate-900">{checkedProduct.name}</h3>
                    <p className="text-xs font-mono text-slate-500">
                      Barcode: <strong>{checkedProduct.barcode}</strong> | SKU: {checkedProduct.sku}
                    </p>

                    <div className="pt-2 flex flex-wrap items-baseline gap-4">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">
                          Selling Price
                        </span>
                        <h4 className="text-2xl font-black text-slate-900">
                          {formatGHS(checkedProduct.selling_price)}
                        </h4>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">
                          Stock Available
                        </span>
                        <p
                          className={`text-sm font-black ${
                            checkedProduct.stock_quantity <= checkedProduct.min_stock_threshold
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {checkedProduct.stock_quantity} {checkedProduct.unit}s
                        </p>
                      </div>
                    </div>

                    <div className="pt-3">
                      <button
                        onClick={() => {
                          addToCart(checkedProduct);
                          setActiveTab('pos');
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-[#F28C28] hover:bg-orange-600 text-white rounded-xl text-xs font-bold shadow-md transition"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add To Current Sale</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : checkerQuery.trim() ? (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-slate-500">
                <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-700">No match for "{checkerQuery}"</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Check the barcode digits and try again.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* 4. SHIFT & CASH DRAWER VIEW */}
      {/* ========================================================================= */}
      {activeTab === 'shift' && (
        <section className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto bg-slate-50">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">Shift & Cash Drawer Management</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Track cash float, cash drop movements, mobile money reconciliations, and close
                  shift
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCashMovementModal('cash_in')}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  <span>Cash In (Float)</span>
                </button>

                <button
                  onClick={() => setShowCashMovementModal('cash_out')}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition shadow-sm"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Cash Out (Drop)</span>
                </button>

                <button
                  onClick={() => setShowCloseShiftModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-[#F28C28] hover:bg-orange-600 text-white rounded-xl text-xs font-bold transition shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Close Shift</span>
                </button>
              </div>
            </div>

            {/* Shift Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <span className="text-xs font-semibold text-slate-500">Opening Float</span>
                <h3 className="text-2xl font-black text-slate-900 mt-1">
                  {formatGHS(currentShift?.opening_cash || 250)}
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">Started at till opening</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <span className="text-xs font-semibold text-slate-500">Cash Sales (Shift)</span>
                <h3 className="text-2xl font-black text-emerald-600 mt-1">
                  {formatGHS(currentShift?.cash_sales || 287)}
                </h3>
                <p className="text-[11px] text-emerald-600 mt-1">Direct cash tendered</p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <span className="text-xs font-semibold text-slate-500">Mobile Money Sales</span>
                <h3 className="text-2xl font-black text-blue-600 mt-1">
                  {formatGHS(
                    sales
                      .filter((s) => s.payment_method === 'mobile_money')
                      .reduce((acc, curr) => acc + curr.total_amount, 0)
                  )}
                </h3>
                <p className="text-[11px] text-blue-600 mt-1">MTN & Telecel Cash</p>
              </div>

              <div className="bg-gradient-to-br from-[#102A4C] to-slate-800 text-white p-5 rounded-2xl shadow-sm">
                <span className="text-xs font-semibold text-slate-300">Expected Cash In Till</span>
                <h3 className="text-2xl font-black text-white mt-1">
                  {formatGHS(currentShift?.expected_cash || 537)}
                </h3>
                <p className="text-[11px] text-orange-300 mt-1">Float + Cash Sales</p>
              </div>
            </div>

            {/* Cash Drawer Movements Ledger */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-3">
                Cash In / Cash Out Movements Ledger
              </h3>
              {cashMovements.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  No cash drawer movements recorded in this shift.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                        <th className="pb-2">Time</th>
                        <th className="pb-2">Movement Type</th>
                        <th className="pb-2">Reason</th>
                        <th className="pb-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cashMovements.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 text-slate-500">
                            {new Date(m.created_at).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                m.type === 'cash_in'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              {m.type === 'cash_in' ? 'Cash In (Float)' : 'Cash Out (Drop)'}
                            </span>
                          </td>
                          <td className="py-2.5 text-slate-700">{m.reason}</td>
                          <td className="py-2.5 text-right font-black text-slate-900">
                            {formatGHS(m.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Terminal & hardware settings now live in the Shop Owner dashboard — cashiers cannot change them. */}

      {/* Animated receipt printing display — automatic: prints, then self-dismisses */}
      {printingSale && (
        <ReceiptPrinterModal
          sale={printingSale}
          tenant={currentTenant}
          paperSize={terminalSettings.printer_paper_size}
          onPrint={() => onPrintLastReceipt(printingSale, { autoPrint: true })}
          onClose={() => setPrintingSale(null)}
        />
      )}

      {/* ========================================================================= */}
      {/* MODALS: CASH, MOMO, CARD, PARKED CARTS, CASH MOVEMENTS, CLOSE SHIFT */}
      {/* ========================================================================= */}

      {/* 1. Cash Payment Modal */}
      {activePaymentModal === 'cash' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-1">
              <Banknote className="w-5 h-5 text-[#F28C28]" />
              <span>Cash Payment & Change</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Total Due: <strong className="text-slate-900 text-sm">{formatGHS(totals.total)}</strong>
            </p>

            {/* Quick GHS Bill selection buttons */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Quick Ghanaian Cedi Bills:
              </label>
              <div className="grid grid-cols-5 gap-2">
                {[10, 20, 50, 100, 200].map((bill) => (
                  <button
                    key={bill}
                    type="button"
                    onClick={() => setCashTendered(bill)}
                    className="py-1.5 rounded-lg border border-slate-300 font-bold text-xs text-slate-800 hover:bg-orange-50 hover:border-orange-500 hover:text-[#F28C28] transition"
                  >
                    GH₵ {bill}
                  </button>
                ))}
              </div>
            </div>

            {/* Manual Tendered input */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Amount Tendered (GH₵):
              </label>
              <input
                type="number"
                step="0.5"
                value={cashTendered || ''}
                onChange={(e) => setCashTendered(parseFloat(e.target.value) || 0)}
                className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl font-black text-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#F28C28]"
                placeholder="0.00"
              />
            </div>

            {/* Change Calculation Box */}
            <div
              className={`p-4 rounded-xl mb-5 flex items-center justify-between border ${
                cashChange.isSufficient
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-rose-50 border-rose-200'
              }`}
            >
              <div>
                <p className="text-xs font-semibold text-slate-600">Change Due to Customer</p>
                <h4
                  className={`text-2xl font-black mt-0.5 ${
                    cashChange.isSufficient ? 'text-emerald-700' : 'text-rose-600'
                  }`}
                >
                  {formatGHS(cashChange.changeDue)}
                </h4>
              </div>
              {cashChange.isSufficient ? (
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              ) : (
                <span className="text-xs font-bold text-rose-600">Insufficient</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActivePaymentModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-xs text-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!cashChange.isSufficient}
                onClick={() =>
                  handleFinalizeSale('cash', {
                    cash_tendered: cashTendered,
                    change_due: cashChange.changeDue,
                  })
                }
                className="flex-1 py-2.5 rounded-xl bg-[#F28C28] hover:bg-orange-600 disabled:opacity-40 text-white font-extrabold text-xs shadow-md transition"
              >
                Confirm Cash & Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Mobile Money Modal */}
      {activePaymentModal === 'momo' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-1">
              <Phone className="w-5 h-5 text-amber-500" />
              <span>Ghana Mobile Money Payment</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Total to Debit: <strong className="text-slate-900">{formatGHS(totals.total)}</strong>
            </p>

            <div className="space-y-3.5 mb-6 text-xs font-semibold text-slate-700">
              <div>
                <label className="block mb-1">Network Carrier:</label>
                <div className="grid grid-cols-3 gap-2">
                  {['MTN Mobile Money', 'Telecel Cash', 'AT Money'].map((net) => (
                    <button
                      key={net}
                      type="button"
                      onClick={() => setMomoNetwork(net)}
                      className={`py-2 px-2 rounded-xl border text-center text-[11px] font-bold transition ${
                        momoNetwork === net
                          ? 'border-amber-500 bg-amber-50 text-amber-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {net}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block mb-1">Customer Mobile Number:</label>
                <input
                  type="text"
                  value={momoPhone}
                  onChange={(e) => setMomoPhone(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900"
                  placeholder="024 123 4567"
                />
              </div>

              <div>
                <label className="block mb-1">MoMo Transaction Reference:</label>
                <input
                  type="text"
                  value={momoReference}
                  onChange={(e) => setMomoReference(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs text-slate-800"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActivePaymentModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-xs text-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  handleFinalizeSale('mobile_money', {
                    momo_network: momoNetwork,
                    momo_number: momoPhone,
                    momo_reference: momoReference,
                  })
                }
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs shadow-md transition"
              >
                Confirm MoMo Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Card Payment Modal */}
      {activePaymentModal === 'card' && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-1">
              <CreditCard className="w-5 h-5 text-blue-600" />
              <span>POS Card Terminal</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Swipe/insert card for <strong className="text-slate-900">{formatGHS(totals.total)}</strong>
            </p>

            <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 text-center mb-6">
              <p className="text-xs font-bold text-blue-900">Waiting for PIN / contactless tap...</p>
              <p className="text-[11px] text-blue-700 mt-1">Visa, Mastercard, & Gh-Link accepted</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActivePaymentModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 font-bold text-xs text-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  handleFinalizeSale('card', {
                    card_reference: `CARD-${Math.floor(100000 + Math.random() * 900000)}`,
                  })
                }
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-md transition"
              >
                Confirm Card Approved
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Parked Carts Modal */}
      {showParkedModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <PauseCircle className="w-5 h-5 text-amber-500" />
                <span>Held & Parked Sales ({parkedCarts.length})</span>
              </h3>
              <button
                onClick={() => setShowParkedModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {parkedCarts.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No held sales currently.</p>
              ) : (
                parkedCarts.map((p) => (
                  <div
                    key={p.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900">{p.customer_name}</p>
                      <p className="text-[11px] text-slate-500">
                        {p.items.length} items • {formatGHS(p.total_amount)}
                      </p>
                      {p.notes && <p className="text-[10px] text-amber-600 mt-0.5">{p.notes}</p>}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleResumeParkedCart(p)}
                        className="px-3 py-1.5 bg-[#F28C28] hover:bg-orange-600 text-white text-xs font-bold rounded-lg transition"
                      >
                        Resume Till
                      </button>
                      <button
                        onClick={() => db.deleteParkedCart(p.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. Line Item Discount Modal */}
      {discountItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2 mb-1">
              <Percent className="w-4 h-4 text-emerald-600" />
              <span>Apply Discount</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">{discountItem.product.name}</p>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {[5, 10, 15, 20].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setDiscountPercentInput(pct)}
                  className={`py-2 rounded-lg border text-xs font-bold transition ${
                    discountPercentInput === pct
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>

            <div className="mb-5">
              <label className="block text-xs font-bold text-slate-700 mb-1">Custom Percent:</label>
              <input
                type="number"
                min="0"
                max="100"
                value={discountPercentInput}
                onChange={(e) => setDiscountPercentInput(parseInt(e.target.value, 10) || 0)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDiscountItem(null)}
                className="flex-1 py-2 rounded-xl border border-slate-200 font-bold text-xs text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleApplyLineDiscount(discountPercentInput)}
                className="flex-1 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Cash In / Cash Out Modal */}
      {showCashMovementModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordCashMovement}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100"
          >
            <h3 className="text-base font-black text-slate-900 mb-1">
              {showCashMovementModal === 'cash_in' ? 'Cash In (Float Entry)' : 'Cash Out (Drop / Expense)'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">Record cash moving in or out of Till #01</p>

            <div className="space-y-3 text-xs font-semibold text-slate-700 mb-5">
              <div>
                <label className="block mb-1">Amount (GH₵):</label>
                <input
                  type="number"
                  step="1"
                  required
                  value={movementAmount}
                  onChange={(e) => setMovementAmount(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-black text-lg text-slate-900"
                />
              </div>

              <div>
                <label className="block mb-1">Reason / Description:</label>
                <input
                  type="text"
                  required
                  value={movementReason}
                  onChange={(e) => setMovementReason(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium"
                  placeholder="e.g. Change float from supervisor"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCashMovementModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-xs text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-[#102A4C] hover:bg-slate-800 text-white font-bold text-xs"
              >
                Save Movement
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 7. Close Shift Modal */}
      {showCloseShiftModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCloseShift}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100"
          >
            <h3 className="text-base font-black text-slate-900 mb-1">Close Till Shift & Z-Report</h3>
            <p className="text-xs text-slate-500 mb-4">
              Enter physical cash count in drawer to calculate variance
            </p>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-xs text-slate-600 mb-4">
              <div className="flex justify-between">
                <span>Opening Cash:</span>
                <span className="font-bold">{formatGHS(currentShift?.opening_cash || 250)}</span>
              </div>
              <div className="flex justify-between">
                <span>Cash Sales Recorded:</span>
                <span className="font-bold">{formatGHS(currentShift?.cash_sales || 287)}</span>
              </div>
              <div className="flex justify-between text-slate-900 font-black pt-1 border-t border-slate-200">
                <span>Expected Total:</span>
                <span className="text-[#F28C28]">
                  {formatGHS(currentShift?.expected_cash || 537)}
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs font-semibold text-slate-700 mb-5">
              <div>
                <label className="block mb-1">Physical Cash Count (GH₵):</label>
                <input
                  type="number"
                  step="0.5"
                  required
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-black text-lg text-slate-900"
                  placeholder="537.00"
                />
              </div>

              <div>
                <label className="block mb-1">Closing Notes / Discrepancy explanation:</label>
                <input
                  type="text"
                  value={shiftCloseNotes}
                  onChange={(e) => setShiftCloseNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium"
                  placeholder="e.g. End of morning shift balanced"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCloseShiftModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-xs text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold text-xs shadow-md"
              >
                Complete Shift Closing
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
