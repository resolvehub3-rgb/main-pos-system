import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { SuperAdminDashboard } from './components/SuperAdminDashboard';
import { ShopOwnerDashboard } from './components/ShopOwnerDashboard';
import { CashierPOS } from './components/CashierPOS';
import { ReceiptModal } from './components/ReceiptModal';
import { CustomerDisplayModal } from './components/CustomerDisplayModal';
import { AddProductModal } from './components/AddProductModal';
import { SupabaseConfigModal } from './components/SupabaseConfigModal';
import { AuthPage } from './components/AuthPage';
import { db } from './lib/supabaseClient';
import { UserAccount, CartItem, Sale, Product, Tenant } from './types';
import { calculateCartTotals } from './lib/money';
import { ArrowLeft, Store } from 'lucide-react';

export default function App() {
  // Authentication & Current User Session
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => db.getCurrentUser());
  const [selectedShopId, setSelectedShopId] = useState<string>('tenant-accra-mall');
  const [shopOwnerViewingPOS, setShopOwnerViewingPOS] = useState<boolean>(false);
  const [, setTick] = useState<number>(0);

  // Modals state
  // `autoPrint` = silent post-checkout print (no modal shown); false for reprints
  const [activeReceipt, setActiveReceipt] = useState<{ sale: Sale; autoPrint: boolean } | null>(null);
  const [showCustomerDisplay, setShowCustomerDisplay] = useState<boolean>(false);
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

  // If user is not authenticated, show the Login and Register page
  if (!currentUser) {
    return (
      <AuthPage
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          if (user.tenant_id) {
            setSelectedShopId(user.tenant_id);
          }
        }}
      />
    );
  }

  // Cart totals for customer display
  const cartTotals = calculateCartTotals(
    cart.map((c) => ({
      price: c.product.selling_price,
      quantity: c.quantity,
      discountPercent: c.discount_percent,
    }))
  );

  return (
    <div className="min-h-screen bg-[#F5F7FA] flex flex-col text-slate-800 antialiased font-['Montserrat',sans-serif]">
      {/* Header with User Profile Menu & Logout (no role switcher buttons) */}
      <Header
        currentUser={currentUser}
        currentRole={currentUser.role}
        selectedShop={selectedShopId}
        onShopChange={setSelectedShopId}
        onOpenSupabaseModal={() => setShowSupabaseModal(true)}
        onOpenCustomerDisplay={() => setShowCustomerDisplay(true)}
        isConnectedToSupabase={supabaseConfig.isConnected}
        onLogout={handleLogout}
      />

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
              onOpenCustomerDisplay={() => setShowCustomerDisplay(true)}
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
            onOpenCustomerDisplay={() => setShowCustomerDisplay(true)}
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

      {/* Customer-Facing Dual Screen Display */}
      {showCustomerDisplay && (
        <CustomerDisplayModal
          tenant={currentTenant}
          cart={cart}
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
