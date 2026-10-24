import React, { useRef, useState } from 'react';
import { X, Package, Barcode, Sparkles, Plus, Image, Upload, Trash2, Loader2 } from 'lucide-react';
import { Product } from '../types';
import { db } from '../lib/supabaseClient';

interface AddProductModalProps {
  tenantId: string;
  onAddProduct: (product: Omit<Product, 'id' | 'created_at'>) => void;
  onClose: () => void;
}

export const AddProductModal: React.FC<AddProductModalProps> = ({
  tenantId,
  onAddProduct,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showQuickCategory, setShowQuickCategory] = useState(false);
  const [quickCategoryName, setQuickCategoryName] = useState('');
  const [quickCategoryError, setQuickCategoryError] = useState('');
  const [costPrice, setCostPrice] = useState('5.00');
  const [sellingPrice, setSellingPrice] = useState('7.50');
  const [stockQuantity, setStockQuantity] = useState('50');
  const [minStock, setMinStock] = useState('10');
  const [unit, setUnit] = useState('Pack');

  // Product image: uploaded file stored as a compressed data-URL (renders instantly everywhere)
  const PLACEHOLDER_IMAGE =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23e2e8f0'/><text x='200' y='210' font-family='sans-serif' font-size='26' font-weight='600' fill='%2394a3b8' text-anchor='middle'>No Image</text></svg>";
  const [imageUrl, setImageUrl] = useState('');
  const [imageError, setImageError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_IMAGE_SIZE_MB = 5;

  // Downscale + compress on the client so uploads stay light in storage and sync instantly
  const compressImage = (dataUrl: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = document.createElement('img');
      img.onload = () => {
        const maxDimension = 480;
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => reject(new Error('Could not read this image file.'));
      img.src = dataUrl;
    });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so re-selecting the same file fires this handler again
    e.target.value = '';
    if (!file) return;

    setImageError('');

    if (!file.type.startsWith('image/')) {
      setImageError('Please choose a valid image file (JPG, PNG or WebP).');
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      setImageError(`Image must be smaller than ${MAX_IMAGE_SIZE_MB} MB.`);
      return;
    }

    setIsProcessingImage(true);
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read this file.'));
        reader.readAsDataURL(file);
      });

      const compressed = await compressImage(raw).catch(() => raw);
      setImageUrl(compressed);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Image upload failed. Please try another file.');
    } finally {
      setIsProcessingImage(false);
    }
  };

  // Shop-managed categories (owner creates/renames these in Inventory → Categories)
  const shopCategories = db.getCategories(tenantId, { activeOnly: true });
  const parentCategories = shopCategories.filter((c) => !c.parent_id);
  const subcategoriesOf = (id: string) => shopCategories.filter((c) => c.parent_id === id);

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

  const generateRandomBarcode = () => {
    // Generate valid 13-digit EAN style string
    const rand = '600' + Math.floor(100000000 + Math.random() * 900000000).toString();
    setBarcode(rand);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Product name is required');
      return;
    }
    const finalBarcode = barcode.trim() || '600' + Date.now().toString().slice(-9);

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

    onAddProduct({
      tenant_id: tenantId,
      name: name.trim(),
      sku: `SKU-${Date.now().toString().slice(-5)}`,
      barcode: finalBarcode,
      category_id: finalCategoryId || undefined,
      category_name: finalCategoryName,
      cost_price: parseFloat(costPrice) || 0,
      selling_price: parseFloat(sellingPrice) || 0,
      stock_quantity: parseInt(stockQuantity, 10) || 0,
      min_stock_threshold: parseInt(minStock, 10) || 5,
      image_url: imageUrl || PLACEHOLDER_IMAGE,
      unit,
      is_active: true,
    });

    // Keep the modal open so the owner can add more products; they close it themselves.
    setSuccessMsg(`"${name.trim()}" added to your catalogue.`);
    setName('');
    setBarcode('');
    setImageUrl('');
    setImageError('');
    setCategoryId('');
    setQuickCategoryName('');
    setShowQuickCategory(false);
    setQuickCategoryError('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-[#F28C28]" />
            <h3 className="font-extrabold text-base text-slate-900">Add Supermarket Product</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Add Product Modal"
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 my-4 text-xs font-medium text-slate-700">
          {/* Success confirmation (stays visible until the owner closes the modal) */}
          {successMsg && (
            <div className="flex items-center justify-between gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-semibold">
              <span>{successMsg}</span>
              <button
                type="button"
                onClick={() => setSuccessMsg('')}
                className="text-emerald-600 hover:text-emerald-900 font-bold"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Product Name */}
          <div>
            <label className="block font-bold mb-1">Product Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Indomie Instant Noodles (Special Chicken)"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (successMsg) setSuccessMsg('');
              }}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            />
          </div>

          {/* Barcode & Auto-Generator */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold">Retail Barcode (EAN-13 / UPC)</label>
              <button
                type="button"
                onClick={generateRandomBarcode}
                className="text-[#F28C28] hover:underline font-bold flex items-center gap-1 text-[11px]"
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto-Generate</span>
              </button>
            </div>
            <div className="relative">
              <Barcode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Scan barcode or type digits"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              />
            </div>
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

          {/* Stock Quantity & Low Stock Threshold */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">Initial Stock Qty</label>
              <input
                type="number"
                required
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold mb-1">Low Stock Alert Qty</label>
              <input
                type="number"
                required
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              />
            </div>
          </div>

          {/* Product Image Upload */}
          <div>
            <label className="block font-bold mb-1">Product Image</label>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />

            {imageUrl ? (
              <div className="flex items-center gap-4 p-3 rounded-xl border border-slate-300 bg-slate-50">
                <div className="relative w-28 h-28 flex-shrink-0">
                  <img
                    src={imageUrl}
                    alt="Product preview"
                    className="w-28 h-28 rounded-full object-cover border-2 border-white shadow-md"
                  />
                  {isProcessingImage && (
                    <div className="absolute inset-0 rounded-full bg-white/70 backdrop-blur-sm flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-[#F28C28]" />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 min-w-0">
                  <p className="text-[11px] font-bold text-slate-500 truncate">
                    {isProcessingImage ? 'Processing image…' : 'Image ready'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessingImage}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-bold border border-slate-300 shadow-sm transition disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Change</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setImageUrl('');
                        setImageError('');
                      }}
                      disabled={isProcessingImage}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold shadow-sm transition disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessingImage}
                className="w-28 h-28 mx-auto rounded-full border-2 border-dashed border-slate-300 hover:border-[#F28C28] bg-slate-50 hover:bg-orange-50/50 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-[#F28C28] transition disabled:opacity-60"
              >
                {isProcessingImage ? (
                  <Loader2 className="w-6 h-6 animate-spin text-[#F28C28]" />
                ) : (
                  <Upload className="w-6 h-6" />
                )}
                <span className="text-[10px] font-bold">
                  {isProcessingImage ? 'Processing…' : 'Upload Image'}
                </span>
              </button>
            )}

            {imageError && (
              <p className="mt-1.5 text-[11px] font-semibold text-rose-600 flex items-center gap-1.5">
                <Image className="w-3.5 h-3.5" />
                {imageError}
              </p>
            )}
          </div>

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
              Add Product
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
