import React, { useState } from 'react';
import {
  Tags,
  Plus,
  Edit2,
  EyeOff,
  Eye,
  CheckCircle2,
  AlertTriangle,
  FolderTree,
} from 'lucide-react';
import { db } from '../lib/supabaseClient';
import { canManageCategories } from '../lib/permissions';
import { Product, ProductCategory, Tenant } from '../types';

interface CategoryManagerProps {
  currentTenant: Tenant;
  products: Product[];
}

/**
 * Shop-admin category management (Inventory → Categories).
 * Create / rename / edit / deactivate categories and optional subcategories,
 * and reassign products between categories. Enforced by the service layer —
 * cashiers are rejected server-side even if this UI were reached.
 */
export const CategoryManager: React.FC<CategoryManagerProps> = ({ currentTenant, products }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#F28C28');
  const [parentId, setParentId] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const tenantId = currentTenant.id;
  const authorized = canManageCategories(db.getCurrentUser(), tenantId);
  const categories = db.getCategories(tenantId);

  const productCount = (categoryId: string) =>
    products.filter((p) => p.category_id === categoryId).length;

  const parentCategories = categories.filter((c) => !c.parent_id);
  const subcategoriesOf = (id: string) => categories.filter((c) => c.parent_id === id);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const result = db.addCategory({
      tenant_id: tenantId,
      name,
      description: description || undefined,
      color,
      parent_id: parentId || null,
    });
    if (result.success) {
      setMessage({ kind: 'success', text: `Category "${result.category?.name}" created.` });
      setName('');
      setDescription('');
      setParentId('');
    } else {
      setMessage({ kind: 'error', text: result.message || 'Could not create the category.' });
    }
  };

  const startEdit = (category: ProductCategory) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditDescription(category.description || '');
  };

  const saveEdit = () => {
    if (!editingId) return;
    const result = db.updateCategory(editingId, {
      name: editName,
      description: editDescription || undefined,
    });
    if (result.success) {
      setMessage({ kind: 'success', text: 'Category updated.' });
      setEditingId(null);
    } else {
      setMessage({ kind: 'error', text: result.message || 'Could not update the category.' });
    }
  };

  const toggleActive = (category: ProductCategory) => {
    if (category.is_active) {
      const count = productCount(category.id);
      const warning = count
        ? `"${category.name}" still has ${count} product(s). They keep their category and history, but no NEW products can use it until it is reactivated. Deactivate anyway?`
        : `Deactivate "${category.name}"? Existing records are preserved.`;
      if (!confirm(warning)) return;
    }
    const result = db.setCategoryActive(category.id, !category.is_active);
    if (result.success) {
      setMessage({
        kind: 'success',
        text: category.is_active
          ? `"${category.name}" deactivated — historical records preserved.`
          : `"${category.name}" reactivated.`,
      });
    } else {
      setMessage({ kind: 'error', text: result.message || 'Could not change category status.' });
    }
  };

  const assignProduct = (productId: string, newCategoryId: string) => {
    const ok = db.updateProduct(
      productId,
      newCategoryId
        ? {
            category_id: newCategoryId,
            category_name: categories.find((c) => c.id === newCategoryId)?.name,
          }
        : { category_id: undefined, category_name: undefined }
    );
    setMessage(
      ok
        ? { kind: 'success', text: 'Product category updated.' }
        : { kind: 'error', text: 'Could not reassign — the category is inactive or not in this shop.' }
    );
  };

  if (!authorized) {
    return (
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 text-rose-600">
          <AlertTriangle className="w-5 h-5" />
          <p className="font-bold text-sm">
            Category management is restricted to the shop owner or authorized shop administrator.
          </p>
        </div>
      </div>
    );
  }

  const renderCategoryRow = (category: ProductCategory, isSub: boolean) => {
    const count = productCount(category.id);
    const editing = editingId === category.id;
    return (
      <tr key={category.id} className={`hover:bg-slate-50/70 ${isSub ? 'bg-slate-50/40' : ''}`}>
        <td className="py-3">
          <div className={`flex items-center gap-2 ${isSub ? 'pl-6' : ''}`}>
            {!isSub && <FolderTree className="w-4 h-4 text-slate-300" />}
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: category.color || '#F28C28' }}
            />
            {editing ? (
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-bold text-slate-900 text-xs w-44 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
              />
            ) : (
              <span className={`font-bold text-slate-900 ${isSub ? 'text-xs' : ''}`}>
                {isSub && <span className="text-slate-400 mr-1">↳</span>}
                {category.name}
              </span>
            )}
          </div>
        </td>
        <td className="py-3 text-slate-500">
          {editing ? (
            <input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Optional details"
              className="p-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-xs w-48 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            />
          ) : (
            category.description || '—'
          )}
        </td>
        <td className="py-3 font-bold text-slate-800">{count}</td>
        <td className="py-3">
          {category.is_active ? (
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">
              Active
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-bold">
              Deactivated
              {category.deactivated_at
                ? ` ${new Date(category.deactivated_at).toLocaleDateString()}`
                : ''}
            </span>
          )}
        </td>
        <td className="py-3 text-right space-x-2 whitespace-nowrap">
          {editing ? (
            <>
              <button
                onClick={saveEdit}
                className="px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-[10px] transition"
              >
                Save
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[10px] transition"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => startEdit(category)}
                className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] transition inline-flex items-center gap-1"
              >
                <Edit2 className="w-3 h-3" />
                <span>Rename</span>
              </button>
              <button
                onClick={() => toggleActive(category)}
                className={`px-2.5 py-1 rounded font-bold text-[10px] transition inline-flex items-center gap-1 ${
                  category.is_active
                    ? 'bg-rose-50 hover:bg-rose-100 text-rose-600'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                }`}
              >
                {category.is_active ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                <span>{category.is_active ? 'Deactivate' : 'Reactivate'}</span>
              </button>
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      {/* Create category */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Tags className="w-5 h-5 text-[#F28C28]" />
          <h3 className="text-lg font-black text-slate-900">Create Category</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Your shop's own categories — e.g. Water, Soft Drinks, Toiletries, Groceries, Household
          &amp; Cleaning Products, Hard Goods. Optional subcategories supported one level deep.
        </p>

        {message && (
          <div
            className={`flex items-center justify-between gap-2 p-3 mb-4 rounded-xl text-xs font-semibold border ${
              message.kind === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-rose-50 border-rose-200 text-rose-600'
            }`}
          >
            <span className="flex items-center gap-2">
              {message.kind === 'success' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              {message.text}
            </span>
            <button onClick={() => setMessage(null)} className="font-bold underline">
              Dismiss
            </button>
          </div>
        )}

        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs font-medium text-slate-700">
          <div>
            <label className="block font-bold mb-1">Category Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Soft Drinks"
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Details (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Bottled carbonated drinks"
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Parent (for subcategory)</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
            >
              <option value="">— None (top level) —</option>
              {parentCategories
                .filter((c) => c.is_active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block font-bold mb-1">Colour</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full h-[42px] p-1 bg-slate-50 border border-slate-300 rounded-xl cursor-pointer"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#F28C28] hover:bg-orange-600 text-white font-extrabold shadow-md shadow-orange-500/20 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Create</span>
            </button>
          </div>
        </form>
      </div>

      {/* Category list */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 mb-3">
          Existing Categories ({categories.length})
        </h3>
        {categories.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">
            No categories yet — create your first one above, or add one while creating a product.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Details</th>
                  <th className="pb-2">Products</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parentCategories.map((c) => (
                  <React.Fragment key={c.id}>
                    {renderCategoryRow(c, false)}
                    {subcategoriesOf(c.id).map((sub) => renderCategoryRow(sub, true))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] text-slate-400 mt-3">
          Deactivating a category never deletes products or historical stock records — it only
          prevents assigning new products to it. Reactivate any time.
        </p>
      </div>

      {/* Reassign products to categories */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 mb-1">Assign Products to Categories</h3>
        <p className="text-xs text-slate-500 mb-4">
          Move products between your active categories. Deactivated categories are not selectable.
        </p>
        {products.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No products in this shop yet.</p>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Current Category</th>
                  <th className="pb-2 text-right">Move To</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 font-bold text-slate-900">{p.name}</td>
                    <td className="py-2.5 text-slate-600">{p.category_name || 'Uncategorised'}</td>
                    <td className="py-2.5 text-right">
                      <select
                        value={p.category_id || ''}
                        onChange={(e) => assignProduct(p.id, e.target.value)}
                        className="p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-800 text-[11px] focus:ring-2 focus:ring-[#F28C28] focus:outline-none"
                      >
                        <option value="">Uncategorised</option>
                        {categories
                          .filter((c) => c.is_active)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.parent_id
                                ? `↳ ${c.name}`
                                : c.name}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
