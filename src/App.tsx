import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { SuperAdminDashboard } from './components/SuperAdminDashboard';
import { ShopOwnerDashboard } from './components/ShopOwnerDashboard';
import { CashierPOS } from './components/CashierPOS';
import { ReceiptModal } from './components/ReceiptModal';
import { CustomerDisplayModal } from './components/CustomerDisplayModal';
import { UpdateNotice } from './components/UpdateNotice';
import { AddProductModal } from './components/AddProductModal';
import { SupabaseConfigModal } from './components/SupabaseConfigModal';
import { AuthPage } from './components/AuthPage';
import { OfflineBanner } from './components/OfflineBanner';
import { db } from './lib/supabaseClient';
import { syncAuthUrl } from './lib/roleRoute';
import { UserAccount, CartItem, Sale, Product, Tenant } from './types';
import { calculateCartTotals } from './lib/money';
import { buildCustomerDisplayState, cartToCustomerItems } from './lib/customerDisplay';
import {
  publishCustomerDisplayState,
  serveCustomerDisplay,
} from './lib/customerDisplayChannel';
import { ArrowLeft, Store } from 'lucide-react';

export default function App({initialAuthTab = 'login'}: {initialAuthTab?: 'login' | 'register'} = {}) {
  // Authentication & Current User Session
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => db.getCurrentUser());
  const [selectedShopId, setSelectedShopId] = useState<string>('tenant-accra-mall');
  const [shopOwnerViewingPOS, setShopOwnerViewingPOS] = useState<boolean>(false);
  const [, setTick] = useState<number>(0);

  // Modals state
  // `autoPrint` = silent post-checkout print (no modal shown); false for reprints
  const [activeReceipt, setActiveReceipt] = useState<{ sale: Sale; autoPrint: boolean } | null>(null);
  const [showCustomerDisplay, setShowCustomerDisplay] = useState<boolean>(false);
  // Handle to the customer display popup window (opened by a user gesture).
  const [customerDisplayWindow, setCustomerDisplayWindow] = useState<Window | null>(null);
  const [showAddProductModal, setShowAddProductModal] = useState<boolean>(false);
  const [showSupabaseModal, setShowSupabaseModal] = useState<boolean>(false);

  // Cart state for Cashier POS
  const [cart, setCart] = useState<CartItem[]>([]);

  // Sync selected shop with current user's assigned store
  useEffect(() => {
    if (currentUser?.tenant_id) {
      setSelectedShopId(currentUser.tenant_id);
    }
  }, [currentUser]);

  // Subscribe to real database updates
  useEffect(() => {
    const unsubscribe = db.subscribe(() => {
      setTick((t) => t + 1);
      // Keep currentUser state in sync with database if updated
      const current = db.getCurrentUser();
      if (current && (!currentUser || current.id !== currentUser.id || current.role !== currentUser.role)) {
        setCurrentUser(current);
      }
    });
    return () => unsubscribe();
  }, [currentUser]);

  // The address bar must show the signed-in role's own URL, never the auth
  // page the operator happened to arrive on. Sign-in, session restore, a
  // role change pushed over realtime and logout all pass through this state,
  // so one effect covers every transition (see src/lib/roleRoute.ts).
  useEffect(() => {
    syncAuthUrl(currentUser);
  }, [currentUser]);

  // Retrieve current database records
  const tenants = db.getTenants();
  const sales = db.getSales();
  const products = db.getProducts();
  const currentTenant: Tenant =
    tenants.find((t) => t.id === selectedShopId) ||
    tenants[0] || {
      id: currentUser?.tenant_id || `tenant-${currentUser?.id || 'store-1'}`,
      name: currentUser?.shop_name || 'My Supermarket Store',
      slug: 'my-supermarket',
      phone: currentUser?.phone || '',
      email: currentUser?.email || '',
      address: 'Accra, Ghana',
      currency: 'GHS',
      is_active: true,
      subscription_status: 'active',
      created_at: currentUser?.created_at || new Date().toISOString(),
    };
  const activeShift = db.getActiveShift(currentTenant.id);
  const supabaseConfig = db.getConfig();

  // Cart totals for the customer display (same calculation the checkout panel
  // uses). Computed before the auth gate so the push below always has
  // the current amount due.
  const cartTotals = calculateCartTotals(
    cart.map((c) => ({
      price: c.product.selling_price,
      quantity: c.quantity,
      discountPercent: c.discount_percent,
    }))
  );

  // The cashier window is the single source of truth for the cart. Serve the
  // customer display popup: answer its "request-state" ping with the cart as
  // it is now, and forget the window handle when the display closes. Logged
  // out → answer with an empty customer screen.
  useEffect(() => {
    if (!currentUser) return;
    return serveCustomerDisplay(
      () => buildCustomerDisplayState(currentTenant.name, cart, cartTotals.total),
      () => setCustomerDisplayWindow(null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, cart, cartTotals.total, currentTenant.name]);

  // Push every cart change (scan, quantity change, removal, clear, completed
  // sale) to the customer display popup. Logged out → clear the customer
  // screen.
  useEffect(() => {
    publishCustomerDisplayState(
      currentUser
        ? buildCustomerDisplayState(currentTenant.name, cart, cartTotals.total)
        : buildCustomerDisplayState('', [], 0),
    );
  }, [cart, cartTotals.total, currentTenant.name, currentUser]);

  // Handle atomic sale completion
  const handleCompleteSale = (saleData: {
    payment_method: Sale['payment_method'];
    payment_details?: Sale['payment_details'];
    items: { productId: string; quantity: number; discountPercent?: number }[];
  }): Sale => {
    return db.processSale({
      tenant_id: currentTenant.id,
      branch_id: 'branch-main',
      cashier_id: currentUser?.id || 'cashier',
      cashier_name: currentUser?.full_name || 'Cashier',
      shop_name: currentTenant.name,
      payment_method: saleData.payment_method,
      payment_details: saleData.payment_details,
      items: saleData.items,
    });
  };

  // Handle add product
  const handleAddProduct = (newProduct: Omit<Product, 'id' | 'created_at'>) => {
    db.addProduct(newProduct);
  };

  // Handle logout
  const handleLogout = () => {
    db.logout();
    setCurrentUser(null);
    setShopOwnerViewingPOS(false);
  };

  // Open the customer screen as a separate browser window the operator drags
  // to the customer-facing monitor. Browsers only allow windows opened from a
  // user gesture (this button click), so it can never auto-open at startup —
  // and if popups are blocked, fall back to the existing in-page preview
  // modal. Same control, same intent; only the window plumbing differs.
  const openCustomerDisplay = (): void => {
    if (customerDisplayWindow && !customerDisplayWindow.closed) {
      customerDisplayWindow.focus();
      return;
    }
    const popup = window.open(
      '/?view=customer-display',
      'samtill-customer-display',
      'popup=yes,width=1024,height=700',
    );
    if (!popup) {
      // Popup blocked → in-page modal fallback.
      setShowCustomerDisplay(true);
      setCustomerDisplayWindow(null);
      return;
    }
    setCustomerDisplayWindow(popup);
    // If the operator closes the popup, drop the handle so the next click
    // re-opens it instead of focusing a dead window.
    const poll = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(poll);
        setCustomerDisplayWindow(null);
      }
    }, 1000);
  };

  // If user is not authenticated, show the Login and Register page
  if (!currentUser) {
    return (
      <AuthPage
        initialTab={initialAuthTab}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          if (user.tenant_id) {
            setSelectedShopId(user.tenant_id);
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex flex-col text-slate-800 antialiased font-['Montserrat',sans-serif]">
      {/* Header with User Profile Menu & Logout (no role switcher buttons) */}
      <Header
        currentUser={currentUser}
        currentRole={currentUser.role}
        selectedShop={selectedShopId}
        onShopChange={setSelectedShopId}
        onOpenSupabaseModal={() => setShowSupabaseModal(true)}
        onOpenCustomerDisplay={openCustomerDisplay}
        isConnectedToSupabase={supabaseConfig.isConnected}
        onLogout={handleLogout}
      />

      {/* PWA update availability (never interrupts a sale — no auto-reload) */}
      <UpdateNotice />

      {/* Offline notice: the app keeps working from the local mirror */}
      <OfflineBanner />

      {/* Owner previewing POS indicator banner */}
      {currentUser.role === 'shop_owner' && shopOwnerViewingPOS && (
        // Sticky at the navbar's height so scrolling the till can't slide it
        // underneath: the button used to end up covered and unclickable after
        // only a few pixels of scroll. z-30 keeps it below the navbar (z-40),
        // so it tucks in beneath rather than overlapping it.
        <div className="sticky top-16 z-30 bg-[#102A4C] text-orange-200 px-4 py-2 border-b border-orange-500/30 flex items-center justify-between text-xs font-semibold">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-[#F28C28]" />
            <span>Store Owner Till Testing Mode &bull; {currentTenant.name}</span>
          </div>
          <button
            onClick={() => setShopOwnerViewingPOS(false)}
            className="flex items-center gap-1.5 px-3 py-1 bg-[#F28C28] hover:bg-orange-600 text-white rounded-lg transition font-bold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Shop Owner Dashboard</span>
          </button>
        </div>
      )}

      {/* Main View Router based strictly on authenticated user's role */}
      <div className="flex-1">
        {currentUser.role === 'super_admin' && (
          <SuperAdminDashboard
            tenants={tenants}
            sales={sales}
            products={products}
            onAddShop={() => setShowAddProductModal(true)}
          />
        )}

        {currentUser.role === 'shop_owner' && (
          shopOwnerViewingPOS ? (
            <CashierPOS
              currentTenant={currentTenant}
              products={products.filter((p) => p.tenant_id === currentTenant.id)}
              activeShift={activeShift}
              onCompleteSale={handleCompleteSale}
              onPrintLastReceipt={(sale, opts) =>
                setActiveReceipt({ sale, autoPrint: Boolean(opts?.autoPrint) })
              }
              onOpenCustomerDisplay={openCustomerDisplay}
              cart={cart}
              setCart={setCart}
            />
          ) : (
            <ShopOwnerDashboard
              currentTenant={currentTenant}
              sales={sales}
              products={products}
              onOpenAddProduct={() => setShowAddProductModal(true)}
              onOpenPOS={() => setShopOwnerViewingPOS(true)}
            />
          )
        )}

        {currentUser.role === 'cashier' && (
          <CashierPOS
            currentTenant={currentTenant}
            products={products.filter((p) => p.tenant_id === currentTenant.id)}
            activeShift={activeShift}
            onCompleteSale={handleCompleteSale}
            onPrintLastReceipt={(sale, opts) =>
              setActiveReceipt({ sale, autoPrint: Boolean(opts?.autoPrint) })
            }
            onOpenCustomerDisplay={openCustomerDisplay}
            cart={cart}
            setCart={setCart}
          />
        )}
      </div>

      {/* Printable Thermal Receipt */}
      {activeReceipt && (
        <ReceiptModal
          sale={activeReceipt.sale}
          tenant={currentTenant}
          autoPrint={activeReceipt.autoPrint}
          onClose={() => setActiveReceipt(null)}
        />
      )}

      {/* Customer-Facing Dual Screen Display (browser preview & single-monitor fallback) */}
      {showCustomerDisplay && (
        <CustomerDisplayModal
          tenantName={currentTenant.name}
          items={cartToCustomerItems(cart)}
          totalAmount={cartTotals.total}
          onClose={() => setShowCustomerDisplay(false)}
        />
      )}

      {/* Add Product Modal */}
      {showAddProductModal && (
        <AddProductModal
          tenantId={currentTenant.id}
          onAddProduct={handleAddProduct}
          onClose={() => setShowAddProductModal(false)}
        />
      )}

      {/* Supabase Connection & Table Inspector Modal */}
      {showSupabaseModal && (
        <SupabaseConfigModal
          config={supabaseConfig}
          onClose={() => setShowSupabaseModal(false)}
          onRefresh={() => setTick((t) => t + 1)}
        />
      )}
    </div>
  );
}
