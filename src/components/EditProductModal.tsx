import React, { useRef, useState } from 'react';
import {
  X,
  Pencil,
  Barcode,
  Sparkles,
  Plus,
  Camera,
  Smartphone,
  Keyboard,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  Plug,
} from 'lucide-react';
import { Product, UserAccount } from '../types';
import { db } from '../lib/supabaseClient';
import {
  findBarcodeConflict,
  generateInternalBarcode,
  validateBarcodeForRegistration,
} from '../lib/barcode';
import { canManageProducts } from '../lib/permissions';
import { BarcodeScannerModal } from './BarcodeScannerModal';

interface EditProductModalProps {
  tenantId: string;
  /**
   * The signed-in owner from App state — the same session the dashboard was
   * gated on. `db.getCurrentUser()` can be cleared independently (refused
   * session restore / SIGNED_OUT), so the permission check reads this prop
   * first and falls back to the db session when absent.
   */
  currentUser?: UserAccount | null;
  product: Product;
  onEditProduct: (productId: string, updates: Partial<Product>) => void;
  onClose: () => void;
}

/** How the owner wants to capture the product's barcode right now. */
type ScanMethod = 'usb-scanner' | 'webcam' | 'mobile-camera' | 'manual';

const SCAN_METHODS: { id: ScanMethod; label: string; hint: string; icon: typeof Barcode }[] = [
  {
    id: 'usb-scanner',
    label: 'USB / Bluetooth Scanner',
    hint: 'Pull the scanner trigger over the product barcode',
    icon: Plug,
  },
  {
    id: 'webcam',
    label: 'Computer Webcam',
    hint: 'Read the printed barcode with this computer camera',
    icon: Camera,
  },
  {
    id: 'mobile-camera',
    label: 'Mobile Phone Camera',
    hint: 'Use the back camera to scan the product',
    icon: Smartphone,
  },
  {
    id: 'manual',
    label: 'Manual Entry',
    hint: 'Type the barcode digits by hand',
    icon: Keyboard,
  },
];

/**
 * Shop-owner product editor. Mirrors the Add Product form (including real
 * barcode capture via scanner / webcam / phone camera / keyboard) so an
 * owner can fix a wrong barcode or re-scan the manufacturer code on a
 * product they registered earlier.
 *
 * Stock quantity is deliberately NOT editable here — quantities move through
 * the stock ledger (Inventory → Adjust Stock), which records who changed what.
 */
export const EditProductModal: React.FC<EditProductModalProps> = ({
  tenantId,
  currentUser,
  product,
  onEditProduct,
  onClose,
}) => {
  const [name, setName] = useState(product.name);
  const [barcode, setBarcode] = useState(product.barcode);
  const [categoryId, setCategoryId] = useState(product.category_id || '');
  const [showQuickCategory, setShowQuickCategory] = useState(false);
  const [quickCategoryName, setQuickCategoryName] = useState('');
  const [quickCategoryError, setQuickCategoryError] = useState('');
  const [costPrice, setCostPrice] = useState(product.cost_price.toString());
  const [sellingPrice, setSellingPrice] = useState(product.selling_price.toString());
  const [minStock, setMinStock] = useState(product.min_stock_threshold.toString());
  const [unit, setUnit] = useState(product.unit);
  const [showScanMenu, setShowScanMenu] = useState(false);
  const [cameraScan, setCameraScan] = useState<'webcam' | 'mobile-camera' | null>(null);
  const [error, setError] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Shop-managed categories (owner creates/renames these in Inventory → Categories)
  const shopCategories = db.getCategories(tenantId, { activeOnly: true });
  const parentCategories = shopCategories.filter((c) => !c.parent_id);
  const subcategoriesOf = (id: string) => shopCategories.filter((c) => c.parent_id === id);

  // Live format + duplicate validation against the local product mirror
  // (offline — same lookup the checkout scanner uses).
  const trimmedBarcode = barcode.trim();
  const barcodeCheck = trimmedBarcode ? validateBarcodeForRegistration(trimmedBarcode) : null;
  const barcodeConflict =
    trimmedBarcode && barcodeCheck?.ok
      ? findBarcodeConflict(
          db.getProducts(tenantId),
          trimmedBarcode,
          tenantId,
          product.id,
        )
      : undefined;
  const barcodeUnchanged = trimmedBarcode === product.barcode.trim();

  const handleQuickCreateCategory = () => {
    const catName = quickCategoryName.trim();
    if (!catName) {
      setQuickCategoryError('Enter a category name.');
      return null;
    }
    const result = db.addCategory({ tenant_id: tenantId, name: catName });
    if (!result.success || !result.category) {
      setQuickCategoryError(result.message || 'Could not create the category.');
      return null;
    }
    setQuickCategoryName('');
    setQuickCategoryError('');
    setShowQuickCategory(false);
    return result.category;
  };

  /** Unique, checksum-valid fallback number (GS1 Ghana `600` prefix). */
  const generateRandomBarcode = () => {
    setBarcode(generateInternalBarcode(db.getProducts().map((p) => p.barcode)));
    setError('');
  };

  /** Owner picked a scanning method from the Scan Barcode menu. */
  const handleSelectScanMethod = (method: ScanMethod) => {
    setShowScanMenu(false);
    setError('');
    if (method === 'webcam' || method === 'mobile-camera') {
      setCameraScan(method);
      return;
    }
    // USB/Bluetooth scanners and manual typing both write into the field.
    barcodeInputRef.current?.focus();
    barcodeInputRef.current?.select();
  };

  /** USB/Bluetooth scanners end every read with Enter — consume it. */
  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    setBarcode((value) => value.trim());
  };

  /** Camera scan finished — the decoded barcode lands in the field. */
  const handleCameraCapture = (captured: string) => {
    setBarcode(captured);
    setCameraScan(null);
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // App state's session first (the one that gated the dashboard), falling
    // back to the db session — either source proves ownership; a cashier
    // session fails the check under both.
    if (!canManageProducts(currentUser ?? db.getCurrentUser(), tenantId)) {
      setError('Only the shop owner can edit products.');
      return;
    }
    if (!name.trim()) {
      setError('Product name is required.');
      return;
    }
    if (!trimmedBarcode) {
      setError('Barcode cannot be empty — scan the product barcode or auto-generate one.');
      return;
    }
    if (!barcodeCheck?.ok) {
      setError(barcodeCheck?.message || 'Enter a valid barcode.');
      return;
    }
    if (barcodeConflict) {
      setError(
        `Barcode ${trimmedBarcode} is already used by “${barcodeConflict.name}”. Scan a different barcode or edit that product instead.`,
      );
      return;
    }

    // Optional inline category creation (owner only — guarded in the service)
    let finalCategoryId = categoryId;
    let finalCategoryName: string | undefined;
    if (showQuickCategory && quickCategoryName.trim()) {
      const created = handleQuickCreateCategory();
      if (!created) return;
      finalCategoryId = created.id;
      finalCategoryName = created.name;
    } else {
      finalCategoryName = shopCategories.find((c) => c.id === finalCategoryId)?.name;
    }

    onEditProduct(product.id, {
      name: name.trim(),
      barcode: trimmedBarcode,
      category_id: finalCategoryId || undefined,
      category_name: finalCategoryName,
      cost_price: parseFloat(costPrice) || product.cost_price,
      selling_price: parseFloat(sellingPrice) || product.selling_price,
      min_stock_threshold: parseInt(minStock, 10) || product.min_stock_threshold,
      unit,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <Pencil className="w-5 h-5 text-[#F28C28] flex-shrink-0" />
            <h3 className="font-extrabold text-base text-slate-900 truncate">Edit Product</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Edit Product Modal"
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 my-4 text-xs font-medium text-slate-700">
          {/* Product Name */}
          <div>
            <label className="block font-bold mb-1">Product Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            />
          </div>

          {/* Barcode: re-scan the manufacturer barcode or auto-generate one */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold">
                Retail Barcode{' '}
                <span className="font-medium text-slate-400">
                  (EAN-13 / EAN-8 / UPC-A / UPC-E / Code 128 / Code 39)
                </span>
              </label>
              <button
                type="button"
                onClick={generateRandomBarcode}
                title="Generate a unique internal barcode for a product without a printed one"
                className="text-[#F28C28] hover:underline font-bold flex items-center gap-1 text-[11px]"
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto-Generate</span>
              </button>
            </div>
            <div className="relative">
              <Barcode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={barcodeInputRef}
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder="Scan the product barcode or type it here"
                value={barcode}
                onChange={(e) => {
                  setBarcode(e.target.value);
                  setError('');
                }}
                onKeyDown={handleBarcodeKeyDown}
                className="w-full pl-9 pr-32 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              />
              {/* Scan method chooser: scanner trigger, webcam, phone or keyboard */}
              <button
                type="button"
                onClick={() => setShowScanMenu((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg bg-[#102A4C] hover:bg-slate-800 text-white text-[11px] font-bold flex items-center gap-1.5 transition"
              >
                <ScanLine className="w-3.5 h-3.5" />
                <span>Scan Barcode</span>
              </button>
              {showScanMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowScanMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
                    {SCAN_METHODS.map((method) => {
                      const Icon = method.icon;
                      return (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => handleSelectScanMethod(method.id)}
                          className="w-full flex items-start gap-2.5 p-3 hover:bg-slate-50 text-left transition border-b border-slate-100 last:border-b-0"
                        >
                          <Icon className="w-4 h-4 text-[#F28C28] mt-0.5 flex-shrink-0" />
                          <span>
                            <span className="block font-bold text-slate-800 text-[11px]">
                              {method.label}
                            </span>
                            <span className="block text-[10px] font-medium text-slate-400">
                              {method.hint}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Live validation: format detected + duplicate protection */}
            {barcodeCheck?.ok && !barcodeConflict && (
              <p className="mt-1 text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {barcodeUnchanged
                  ? `${barcodeCheck.format} barcode — unchanged.`
                  : `${barcodeCheck.format} barcode ready.`}
              </p>
            )}
            {barcodeCheck && !barcodeCheck.ok && (
              <p className="mt-1 text-[10px] font-semibold text-rose-600 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {barcodeCheck.message}
              </p>
            )}
            {barcodeConflict && (
              <p className="mt-1 text-[10px] font-semibold text-rose-600 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                This barcode is already assigned to “{barcodeConflict.name}”.
              </p>
            )}
          </div>

          {/* Category & Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold">Category</label>
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickCategory((v) => !v);
                    setQuickCategoryError('');
                  }}
                  className="text-[#F28C28] hover:underline font-bold flex items-center gap-1 text-[11px]"
                >
                  <Plus className="w-3 h-3" />
                  <span>New</span>
                </button>
              </div>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              >
                <option value="">Uncategorised</option>
                {parentCategories.map((c) => (
                  <React.Fragment key={c.id}>
                    <option value={c.id}>{c.name}</option>
                    {subcategoriesOf(c.id).map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        &nbsp;&nbsp;↳ {sub.name}
                      </option>
                    ))}
                  </React.Fragment>
                ))}
              </select>

              {showQuickCategory && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="New category name"
                    value={quickCategoryName}
                    onChange={(e) => {
                      setQuickCategoryName(e.target.value);
                      if (quickCategoryError) setQuickCategoryError('');
                    }}
                    className="flex-1 min-w-0 p-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-900 text-[11px] focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickCreateCategory()}
                    className="px-3 py-2 rounded-lg bg-[#102A4C] hover:bg-slate-800 text-white text-[11px] font-bold transition"
                  >
                    Add
                  </button>
                </div>
              )}
              {quickCategoryError && (
                <p className="mt-1 text-[10px] font-semibold text-rose-600">{quickCategoryError}</p>
              )}
            </div>

            <div>
              <label className="block font-bold mb-1">Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              >
                <option value="Pack">Pack</option>
                <option value="Bottle">Bottle</option>
                <option value="Tin">Tin</option>
                <option value="Tub">Tub</option>
                <option value="Loaf">Loaf</option>
                <option value="Bag">Bag (kg)</option>
                <option value="Box">Box / Carton</option>
                <option value="Piece">Piece</option>
              </select>
            </div>
          </div>

          {/* Cost Price & Selling Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">Cost Price (GH₵)</label>
              <input
                type="number"
                step="0.01"
                required
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold mb-1">Selling Price (GH₵)</label>
              <input
                type="number"
                step="0.01"
                required
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-black text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              />
            </div>
          </div>

          {/* Low Stock Threshold — quantities move through the stock ledger */}
          <div>
            <label className="block font-bold mb-1">Low Stock Alert Qty</label>
            <input
              type="number"
              required
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            />
            <p className="mt-1 text-[10px] font-medium text-slate-400">
              Current stock: {product.stock_quantity} {product.unit}s — adjust quantities from
              Inventory → Adjust Stock so the ledger stays complete.
            </p>
          </div>

          {/* Submission error (invalid / duplicate barcode, permission) */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold shadow-md shadow-orange-500/20 transition"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>

      {/* Live camera scanner (webcam / phone camera) — sibling overlay */}
      {cameraScan && (
        <BarcodeScannerModal
          title={cameraScan === 'webcam' ? 'Scan with Webcam' : 'Scan with Phone Camera'}
          subtitle="Hold the product so its printed barcode fills the frame — scanning stops automatically."
          initialFacing={cameraScan === 'mobile-camera' ? 'environment' : 'user'}
          onCapture={handleCameraCapture}
          onClose={() => setCameraScan(null)}
        />
      )}
    </div>
  );
};
