import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { SuperAdminDashboard } from './components/SuperAdminDashboard';
import { ShopOwnerDashboard } from './components/ShopOwnerDashboard';
import { CashierPOS } from './components/CashierPOS';
import { ReceiptModal } from './components/ReceiptModal';
import { CustomerDisplayModal } from './components/CustomerDisplayModal';
import { KioskNotice } from './components/KioskNotice';
import { UpdateNotice } from './components/UpdateNotice';
import { AddProductModal } from './components/AddProductModal';
import { SupabaseConfigModal } from './components/SupabaseConfigModal';
import { AuthPage } from './components/AuthPage';
import { OfflineBanner } from './components/OfflineBanner';
import { db } from './lib/supabaseClient';
import { syncAuthUrl } from './lib/roleRoute';
import { UserAccount, CartItem, Sale, Product, Tenant, CustomerDisplayPayment } from './types';
import { calculateCartTotals } from './lib/money';
import { buildCustomerDisplayState } from './lib/customerDisplay';
import {
  publishCustomerDisplayState,
  serveCustomerDisplay,
} from './lib/customerDisplayChannel';
import {
  deriveCustomerDisplayConnection,
  getCustomerDisplayConnection,
  setCustomerDisplayConnection,
  useCustomerDisplayConnection,
} from './lib/customerDisplayStatus';
import {
  buildCustomerDisplayUrl,
  isWindowAlive,
  openCustomerDisplayWindow,
} from './lib/dualScreen';
import { getDualScreenSettings, useDualScreenSettings } from './lib/dualScreenSettings';
import {
  exitAppFullscreen,
  isFullscreenActive,
  isFullscreenSupported,
  requestAppFullscreen,
  useFullscreenActive,
} from './lib/fullscreen';
import { isStandalone } from './lib/pwa';
import { clearActiveCart, loadActiveCart, saveActiveCart } from './lib/cartPersist';
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
  // Handle to the customer display popup window (opened by a user gesture).
  const [customerDisplayWindow, setCustomerDisplayWindow] = useState<Window | null>(null);
  const [showAddProductModal, setShowAddProductModal] = useState<boolean>(false);
  const [showSupabaseModal, setShowSupabaseModal] = useState<boolean>(false);
  // A sign-out the operator asked for that is being held until the open shift
  // is counted and closed (see handleLogout / the gate effect below).
  const [pendingSignOut, setPendingSignOut] = useState<boolean>(false);

  // Dual-screen / kiosk preferences for this device (owner-configured).
  const dualScreenSettings = useDualScreenSettings();
  // Whether the till window is currently in full-screen (kiosk) mode.
  const fullscreenActive = useFullscreenActive();
  // One-shot activation notices: browsers refuse full-screen / popups without
  // a gesture, so each is attempted once automatically and then offered as a
  // one-click notice (dismissed for this session only).
  const [fullscreenNotice, setFullscreenNotice] = useState<boolean>(false);
  const [fullscreenNoticeDismissed, setFullscreenNoticeDismissed] = useState<boolean>(false);
  const [blockedNoticeDismissed, setBlockedNoticeDismissed] = useState<boolean>(false);
  // Timestamp of the last customer-display heartbeat (connection status).
  const displayLastAliveRef = useRef<number>(0);
  // Live connection status, rendered from the shared store (see
  // src/lib/customerDisplayStatus.ts) so header, till and settings agree.
  const displayConnection = useCustomerDisplayConnection();

  // Payment confirmation currently shown on the customer display (cleared
  // when the next sale starts, or on a timer, so the screen returns to the
  // welcome state).
  const [customerPayment, setCustomerPayment] = useState<CustomerDisplayPayment | null>(null);

  // Cart state for Cashier POS — restored from the last valid snapshot so a
  // refresh, crash or reconnection mid-sale does not lose the transaction
  // (see src/lib/cartPersist.ts). The cashier window stays the single source
  // of truth; this is only a recovery copy of the same cart.
  const [cart, setCart] = useState<CartItem[]>(() => {
    const user = db.getCurrentUser();
    if (!user?.tenant_id) return [];
    return loadActiveCart(user.tenant_id, user.id, db.getProducts());
  });

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
  // customer display popup: answer its "request-state" heartbeat with the cart
  // as it is now (and record that the display is alive), and forget the window
  // handle when the display closes. Logged out → answer with an empty customer
  // screen. The channel is scoped to this till session (tenant + user) so a
  // second cashier on the same machine can never receive this checkout.
  //
  // The id is computed ONCE per signed-in user and then held: it must never
  // drift mid-session (e.g. while the tenant list finishes loading), or an
  // already-open display would end up listening on a channel nobody publishes
  // to. It stays deterministic across reloads, so a reloaded till re-attaches
  // to the same customer window.
  const displaySessionRef = useRef<{userId: string; sid: string} | null>(null);
  if (currentUser) {
    if (!displaySessionRef.current || displaySessionRef.current.userId !== currentUser.id) {
      displaySessionRef.current = {
        userId: currentUser.id,
        sid: `${currentUser.tenant_id ?? currentTenant.id}:${currentUser.id}`,
      };
    }
  } else {
    displaySessionRef.current = null;
  }
  const displaySessionId = displaySessionRef.current?.sid ?? null;
  useEffect(() => {
    if (!currentUser) return;
    return serveCustomerDisplay(
      () =>
        buildCustomerDisplayState(
          currentTenant.name,
          cart,
          cartTotals,
          currentTenant.logo_url,
          customerPayment ?? undefined,
        ),
      displaySessionId,
      {
        onAlive: () => {
          displayLastAliveRef.current = Date.now();
          setCustomerDisplayConnection('connected');
        },
        onClosed: () => setCustomerDisplayWindow(null),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentUser,
    cart,
    cartTotals,
    customerPayment,
    displaySessionId,
    currentTenant.name,
    currentTenant.logo_url,
  ]);

  // Push every cart change (scan, quantity change, removal, clear, completed
  // sale) to the customer display popup — together with the payment
  // confirmation while the "thank you" screen should be up. The shop name and
  // logo ride along, so a profile photo saved on the owner's device
  // re-publishes here and lands on an already-open customer screen. Logged out
  // → clear the customer screen.
  useEffect(() => {
    publishCustomerDisplayState(
      currentUser
        ? buildCustomerDisplayState(
            currentTenant.name,
            cart,
            cartTotals,
            currentTenant.logo_url,
            customerPayment ?? undefined,
          )
        : buildCustomerDisplayState('', [], calculateCartTotals([])),
      displaySessionId,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cart,
    cartTotals,
    customerPayment,
    displaySessionId,
    currentTenant.name,
    currentTenant.logo_url,
    currentUser,
  ]);

  // Remember the active cart so a refresh/restart restores the sale in
  // progress (keyed per till session; an empty cart just clears the copy).
  useEffect(() => {
    if (!currentUser?.tenant_id) return;
    saveActiveCart(currentUser.tenant_id, currentUser.id, cart);
  }, [cart, currentUser]);

  // The payment confirmation disappears as soon as the next item is scanned
  // (a new sale has started) — the customer screen resets with it.
  useEffect(() => {
    if (customerPayment && cart.length > 0) setCustomerPayment(null);
  }, [cart, customerPayment]);

  // …and on a timer, so a paused till returns to the welcome screen instead
  // of leaving a stale confirmation up all afternoon.
  useEffect(() => {
    if (!customerPayment) return;
    const timer = window.setTimeout(() => setCustomerPayment(null), 20000);
    return () => window.clearTimeout(timer);
  }, [customerPayment]);

  // Handle atomic sale completion
  const handleCompleteSale = (saleData: {
    payment_method: Sale['payment_method'];
    payment_details?: Sale['payment_details'];
    items: { productId: string; quantity: number; discountPercent?: number }[];
  }): Sale => {
    const sale = db.processSale({
      tenant_id: currentTenant.id,
      branch_id: 'branch-main',
      cashier_id: currentUser?.id || 'cashier',
      cashier_name: currentUser?.full_name || 'Cashier',
      shop_name: currentTenant.name,
      payment_method: saleData.payment_method,
      payment_details: saleData.payment_details,
      items: saleData.items,
    });

    // Project the confirmation onto the customer screen. The sale itself is
    // already committed by db.processSale (single source of truth) — this only
    // tells the display what the till just did; it never runs a payment of its
    // own. Cleared when the next sale starts or after a short timeout.
    const details = sale.payment_details;
    setCustomerPayment({
      method: sale.payment_method,
      amount: sale.total_amount,
      ...(details?.change_due !== undefined ? { changeDue: details.change_due } : {}),
      ...(details?.momo_reference
        ? { reference: details.momo_reference }
        : details?.card_reference
          ? { reference: details.card_reference }
          : {}),
      paidAt: sale.created_at,
    });

    return sale;
  };

  // Handle add product. The Add Product modal validates the barcode
  // (format + duplicate) before calling this; the service re-checks and
  // throws on a duplicate, so its message is surfaced instead of swallowed.
  const handleAddProduct = (newProduct: Omit<Product, 'id' | 'created_at'>) => {
    try {
      db.addProduct(newProduct);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not add the product.');
    }
  };

  // Handle logout.
  //
  // A till with an open shift may not sign out — the drawer has to be counted
  // first. The request is held in `pendingSignOut` and routed into the POS
  // screen, which jumps to the Cash Drawer tab and opens the Close Shift /
  // Z-report modal; the moment the shift closes (from that modal, or from
  // another tab's storage write — both re-render `activeShift` live), the
  // effect below finishes the sign-out that was asked for. Dismissing the
  // modal cancels it instead, leaving the operator signed in.
  const performLogout = () => {
    // The active-cart recovery copy belongs to this signed-in session only —
    // drop it on sign-out so it can never surface for a later operator.
    if (currentUser?.tenant_id) clearActiveCart(currentUser.tenant_id, currentUser.id);
    db.logout();
    // Rewrite the URL to /login *before* clearing the user, so the auth page
    // mounts on the Login tab. Without this the tab could fall back to
    // Register for anyone whose first visit was the /register deep link.
    syncAuthUrl(null);
    setCurrentUser(null);
    setShopOwnerViewingPOS(false);
    setPendingSignOut(false);
  };

  // The close-shift controls live on the POS screen, so the gate applies only
  // where they are reachable: always for a cashier (that screen is their whole
  // workspace) and for the owner while they are in till-testing mode. A shift
  // left open behind the owner dashboard has no UI to close it, so it must not
  // turn into a dead end that traps them in the session.
  const posScreenOpen =
    currentUser?.role === 'cashier' ||
    (currentUser?.role === 'shop_owner' && shopOwnerViewingPOS);
  const signOutBlocked = posScreenOpen && Boolean(activeShift);

  const handleLogout = () => {
    if (signOutBlocked) {
      setPendingSignOut(true);
      return;
    }
    performLogout();
  };

  // Release the held sign-out as soon as the gate clears: the shift is closed
  // (or the POS screen that owns the controls went away).
  useEffect(() => {
    if (pendingSignOut && !signOutBlocked) performLogout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSignOut, signOutBlocked]);

  // ---------------------------------------------------------------------------
  // Dual-screen window control (customer display on monitor 2)
  // ---------------------------------------------------------------------------
  // Where the customer display should go when the browser reports a secondary
  // monitor (filled in by the settings panel's monitor detection, reused by
  // every open attempt in this window).
  const displayTargetRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const displayPollRef = useRef<number | null>(null);
  const autoDisplayAttemptedRef = useRef<boolean>(false);
  const autoFullscreenAttemptedRef = useRef<boolean>(false);

  // Drop the handle as soon as the operator closes the popup, so the next
  // click re-opens it instead of focusing a dead window.
  const watchDisplayWindow = (win: Window): void => {
    if (displayPollRef.current !== null) window.clearInterval(displayPollRef.current);
    displayPollRef.current = window.setInterval(() => {
      if (win.closed) {
        if (displayPollRef.current !== null) window.clearInterval(displayPollRef.current);
        displayPollRef.current = null;
        setCustomerDisplayWindow((current) => (current === win ? null : current));
      }
    }, 1000);
  };

  useEffect(
    () => () => {
      if (displayPollRef.current !== null) window.clearInterval(displayPollRef.current);
    },
    [],
  );

  /**
   * Open (or focus) the customer display window.
   *
   * Browsers only allow windows opened from a user gesture, so a manual
   * button click works directly; the automatic start-up attempt may be
   * refused, in which case the status turns `blocked` and the till shows the
   * one-click activation notice. If a click still cannot open a window
   * (site-level popup blocking), the in-page preview modal takes over so the
   * operator is never left without a customer screen. A failure here never
   * interrupts checkout.
   */
  const attemptOpenCustomerDisplay = (
    options: { fallbackToModal?: boolean } = {},
  ): 'focused' | 'opened' | 'blocked' => {
    if (isWindowAlive(customerDisplayWindow)) {
      try {
        customerDisplayWindow?.focus();
      } catch {
        // Focus is best-effort (some browsers refuse it across monitors).
      }
      setCustomerDisplayConnection('connected');
      return 'focused';
    }

    setCustomerDisplayConnection('connecting');
    const opened = openCustomerDisplayWindow({
      url: buildCustomerDisplayUrl(displaySessionId),
      target: displayTargetRef.current,
    });

    if (!opened) {
      setCustomerDisplayConnection('blocked');
      // A click-driven open falls back to the existing in-page preview
      // (single-monitor and popup-blocked users keep working exactly as
      // before); the automatic start-up attempt only raises the notice.
      if (options.fallbackToModal) setShowCustomerDisplay(true);
      return 'blocked';
    }

    setCustomerDisplayWindow(opened.win);
    watchDisplayWindow(opened.win);
    return 'opened';
  };

  // Public handler used by the header, the till sidebar and the settings
  // panel — always a user gesture, so it is also the activation path for a
  // browser that refused the automatic attempt. A click that cannot open a
  // window falls back to the in-page preview so the operator is never stuck.
  const openCustomerDisplay = (): void => {
    attemptOpenCustomerDisplay({ fallbackToModal: true });
  };

  // --- Start-up sequence --------------------------------------------------
  // 1. the till is on screen (cashier, or owner in till mode),
  // 2. read the saved dual-screen configuration,
  // 3. attempt to open the customer display automatically (placement on the
  //    secondary monitor is attempted when detection reported one),
  // 4. a refusal becomes the `blocked` status + one-click activation notice.
  useEffect(() => {
    if (!posScreenOpen || autoDisplayAttemptedRef.current) return;
    const settings = getDualScreenSettings();
    if (!settings.enabled) {
      setCustomerDisplayConnection('off');
      return;
    }
    if (!settings.auto_open) {
      setCustomerDisplayConnection('not-open');
      return;
    }
    autoDisplayAttemptedRef.current = true;
    attemptOpenCustomerDisplay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posScreenOpen]);

  // Reconcile the displayed connection status from the window handle and the
  // display's heartbeats (the display pings every 3s while it is alive).
  useEffect(() => {
    const tick = () =>
      setCustomerDisplayConnection(
        deriveCustomerDisplayConnection({
          enabled: dualScreenSettings.enabled,
          hasWindow: isWindowAlive(customerDisplayWindow),
          current: getCustomerDisplayConnection(),
          lastAliveAt: displayLastAliveRef.current,
          now: Date.now(),
        }),
      );
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [customerDisplayWindow, dualScreenSettings.enabled]);

  // --- Full-screen (kiosk) activation -------------------------------------
  // Browsers require a user gesture for full-screen, so the automatic attempt
  // below is honest: in the installed app a refusal raises the one-click
  // notice, and in a browser tab the header button is always available.
  useEffect(() => {
    if (!posScreenOpen || autoFullscreenAttemptedRef.current) return;
    if (!getDualScreenSettings().auto_fullscreen) return;
    if (!isFullscreenSupported() || isFullscreenActive()) return;
    autoFullscreenAttemptedRef.current = true;
    void requestAppFullscreen().then((result) => {
      if ((result === 'denied' || result === 'failed') && isStandalone()) {
        setFullscreenNotice(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posScreenOpen]);

  const toggleFullscreen = (): void => {
    if (isFullscreenActive()) {
      void exitAppFullscreen();
    } else {
      void requestAppFullscreen().then((result) => {
        if (result === 'denied' || result === 'failed') setFullscreenNotice(true);
      });
    }
  };

  // A customer window belongs to exactly one till session: when the operator
  // signs out (or a different user signs in on this window) close it, so the
  // next session opens its own scoped window instead of focusing a screen
  // that would never receive its cart again. Signing out also leaves kiosk
  // full-screen behind — the sign-in page is a normal page.
  const previousUserIdRef = useRef<string | null>(currentUser?.id ?? null);
  useEffect(() => {
    const userId = currentUser?.id ?? null;
    if (previousUserIdRef.current === userId) return;
    previousUserIdRef.current = userId;

    if (isWindowAlive(customerDisplayWindow)) {
      try {
        customerDisplayWindow?.close();
      } catch {
        // Closing is best-effort (the handle may already be dead).
      }
    }
    setCustomerDisplayWindow(null);
    autoDisplayAttemptedRef.current = false;
    autoFullscreenAttemptedRef.current = false;
    setFullscreenNotice(false);
    setFullscreenNoticeDismissed(false);
    setBlockedNoticeDismissed(false);
    setCustomerPayment(null);
    setCustomerDisplayConnection(getDualScreenSettings().enabled ? 'not-open' : 'off');
    if (!userId) void exitAppFullscreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, customerDisplayWindow]);

  // If user is not authenticated, show the Login and Register page.
  // The tab follows the URL *now*, not whatever tab the session was opened
  // from: a session that started on /register would otherwise return to the
  // Register tab after every logout. Logout rewrites the URL to /login (see
  // handleLogout → syncAuthUrl), so Register only appears for an explicit
  // /register deep link.
  if (!currentUser) {
    const authTab: 'login' | 'register' =
      typeof window !== 'undefined' && window.location.pathname === '/register'
        ? 'register'
        : 'login';
    return (
      <AuthPage
        initialTab={authTab}
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
        customerDisplayStatus={displayConnection}
        onToggleFullscreen={toggleFullscreen}
        fullscreenActive={fullscreenActive}
        isConnectedToSupabase={supabaseConfig.isConnected}
        onLogout={handleLogout}
      />

      {/* PWA update availability (never interrupts a sale — no auto-reload) */}
      <UpdateNotice />

      {/* Offline notice: the app keeps working from the local mirror */}
      <OfflineBanner />

      {/* Full-screen kiosk activation: browsers need a gesture, so when the
          automatic attempt in the installed app is refused we ask once. */}
      {fullscreenNotice && !fullscreenNoticeDismissed && !fullscreenActive && (
        <KioskNotice
          tone="info"
          message="Full-screen kiosk mode is available — enter full screen to use the whole monitor."
          actions={[
            {
              label: 'Enter full screen',
              primary: true,
              onClick: () => {
                void requestAppFullscreen().then((result) => {
                  if (result === 'entered' || result === 'already-fullscreen') {
                    setFullscreenNotice(false);
                  }
                });
              },
            },
          ]}
          onDismiss={() => setFullscreenNoticeDismissed(true)}
        />
      )}

      {/* Customer-display activation: the browser refused to open the second
          window automatically (it needs one click on this origin first). */}
      {dualScreenSettings.enabled &&
        displayConnection === 'blocked' &&
        !showCustomerDisplay &&
        !blockedNoticeDismissed && (
          <KioskNotice
            message="The browser blocked the customer display window — one click allows it (this is remembered for next time)."
            actions={[
              {label: 'Open customer display', primary: true, onClick: openCustomerDisplay},
              {
                label: 'Use on-screen preview',
                onClick: () => setShowCustomerDisplay(true),
              },
            ]}
            onDismiss={() => setBlockedNoticeDismissed(true)}
          />
        )}

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
              pendingSignOut={pendingSignOut}
              onCancelSignOut={() => setPendingSignOut(false)}
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
              currentUser={currentUser}
              sales={sales}
              products={products}
              onOpenAddProduct={() => setShowAddProductModal(true)}
              onOpenPOS={() => setShopOwnerViewingPOS(true)}
              onOpenCustomerDisplay={openCustomerDisplay}
            />
          )
        )}

        {currentUser.role === 'cashier' && (
          <CashierPOS
            currentTenant={currentTenant}
            products={products.filter((p) => p.tenant_id === currentTenant.id)}
            activeShift={activeShift}
            pendingSignOut={pendingSignOut}
            onCancelSignOut={() => setPendingSignOut(false)}
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
          state={buildCustomerDisplayState(
            currentTenant.name,
            cart,
            cartTotals,
            currentTenant.logo_url,
            customerPayment ?? undefined,
          )}
          onClose={() => setShowCustomerDisplay(false)}
        />
      )}

      {/* Add Product Modal */}
      {showAddProductModal && (
        <AddProductModal
          tenantId={currentTenant.id}
          currentUser={currentUser}
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
