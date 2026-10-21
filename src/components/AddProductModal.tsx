import React, { useState } from 'react';
import { X, Package, Barcode, Sparkles, Plus, Image } from 'lucide-react';
import { Product } from '../types';

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
  const [categoryName, setCategoryName] = useState('Noodles & Grains');
  const [costPrice, setCostPrice] = useState('5.00');
  const [sellingPrice, setSellingPrice] = useState('7.50');
  const [stockQuantity, setStockQuantity] = useState('50');
  const [minStock, setMinStock] = useState('10');
  const [unit, setUnit] = useState('Pack');
  const [imageUrl, setImageUrl] = useState(
    'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&auto=format&fit=crop&q=80'
  );

  const categories = [
    'Noodles & Grains',
    'Beverages',
    'Canned & Spices',
    'Dairy & Spreads',
    'Bakery',
    'Baking & Pantry',
    'Cooking Essentials',
    'Snacks & Biscuits',
    'Frozen & Meat',
    'Personal Care & Toiletries',
  ];

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

    onAddProduct({
      tenant_id: tenantId,
      name: name.trim(),
      sku: `SKU-${Date.now().toString().slice(-5)}`,
      barcode: finalBarcode,
      category_name: categoryName,
      cost_price: parseFloat(costPrice) || 0,
      selling_price: parseFloat(sellingPrice) || 0,
      stock_quantity: parseInt(stockQuantity, 10) || 0,
      min_stock_threshold: parseInt(minStock, 10) || 5,
      image_url: imageUrl || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400',
      unit,
      is_active: true,
    });
    onClose();
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
          {/* Product Name */}
          <div>
            <label className="block font-bold mb-1">Product Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Indomie Instant Noodles (Special Chicken)"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              <label className="block font-bold mb-1">Category</label>
              <select
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
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

          {/* Image URL */}
          <div>
            <label className="block font-bold mb-1">Product Image URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://images.unsplash.com/..."
                className="flex-1 p-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              />
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt="preview"
                  className="w-9 h-9 rounded-lg object-cover border border-slate-200 flex-shrink-0"
                />
              )}
            </div>
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
              Save Product to DB
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
