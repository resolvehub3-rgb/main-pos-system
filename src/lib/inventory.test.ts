import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './supabaseClient.ts';
import type { Product, UserAccount } from '../types/index.ts';

// ---------------------------------------------------------------------------
// Service-level integration tests: shop-managed categories, permissions,
// movement ledger, weighted-average cost, checkout integration, stock book.
// (db runs in-memory under Node — localStorage is guarded for non-browser)
// ---------------------------------------------------------------------------

interface Fixture {
  tenantA: { id: string };
  tenantB: { id: string };
  ownerA: UserAccount;
  ownerB: UserAccount;
  cashierA: UserAccount;
}

function setup(): Fixture {
  const tenantA = db.addTenant({
    name: 'Shop A',
    slug: `shop-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    phone: '0240000001',
    email: 'a@example.com',
    address: 'Accra',
    currency: 'GHS',
    is_active: true,
    subscription_status: 'active',
  });
  const tenantB = db.addTenant({
    name: 'Shop B',
    slug: `shop-b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    phone: '0240000002',
    email: 'b@example.com',
    address: 'Kumasi',
    currency: 'GHS',
    is_active: true,
    subscription_status: 'active',
  });

  const ownerA = db.addUser({
    tenant_id: tenantA.id,
    shop_name: tenantA.name,
    full_name: 'Owner A',
    email: `owner-a-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: '0240000001',
    role: 'shop_owner',
    password: 'secret-a',
    is_active: true,
  });
  const ownerB = db.addUser({
    tenant_id: tenantB.id,
    shop_name: tenantB.name,
    full_name: 'Owner B',
    email: `owner-b-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: '0240000002',
    role: 'shop_owner',
    password: 'secret-b',
    is_active: true,
  });
  const cashierA = db.addUser({
    tenant_id: tenantA.id,
    shop_name: tenantA.name,
    full_name: 'Cashier A',
    email: `cashier-a-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: '0240000003',
    role: 'cashier',
    password: 'secret-c',
    is_active: true,
  });

  return { tenantA, tenantB, ownerA, ownerB, cashierA };
}

function addProductTo(tenantId: string, over: Partial<Product> = {}): Product {
  return db.addProduct({
    tenant_id: tenantId,
    name: over.name || `Product ${Math.random().toString(36).slice(2, 6)}`,
    sku: `SKU-${Math.random().toString(36).slice(2, 7)}`,
    barcode: '600' + Math.floor(1000000000 + Math.random() * 8999999999),
    cost_price: 10,
    selling_price: 15,
    stock_quantity: 20,
    min_stock_threshold: 5,
    image_url: '',
    unit: 'Pack',
    is_active: true,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// Category management & permissions
// ---------------------------------------------------------------------------

test('owner creates, renames and lists their own categories', () => {
  const { tenantA, ownerA } = setup();
  db.setCurrentUser(ownerA);

  const created = db.addCategory({ tenant_id: tenantA.id, name: 'Water', description: 'Bottled water' });
  assert.equal(created.success, true);
  assert.equal(created.category?.is_active, true);

  const dup = db.addCategory({ tenant_id: tenantA.id, name: 'water' });
  assert.equal(dup.success, false);

  const renamed = db.updateCategory(created.category!.id, { name: 'Water & Beverages' });
  assert.equal(renamed.success, true);
  assert.equal(renamed.category?.name, 'Water & Beverages');

  const list = db.getCategories(tenantA.id);
  assert.equal(list.length, 1);
});

test('cashiers cannot create, rename or deactivate categories', () => {
  const { tenantA, ownerA, cashierA } = setup();
  db.setCurrentUser(ownerA);
  const cat = db.addCategory({ tenant_id: tenantA.id, name: 'Groceries' });
  assert.equal(cat.success, true);

  db.setCurrentUser(cashierA);
  assert.equal(db.addCategory({ tenant_id: tenantA.id, name: 'Fake' }).success, false);
  assert.equal(db.updateCategory(cat.category!.id, { name: 'Hijacked' }).success, false);
  assert.equal(db.setCategoryActive(cat.category!.id, false).success, false);
  // Reading categories is allowed for staff (needed to label products)
  assert.equal(db.getCategories(tenantA.id).length, 1);
});

test('owner of Shop A cannot touch Shop B categories (tenant isolation)', () => {
  const { tenantB, ownerA } = setup();
  db.setCurrentUser(ownerA);

  // Direct create in tenant B is refused
  const create = db.addCategory({ tenant_id: tenantB.id, name: 'Sneaky' });
  assert.equal(create.success, false);
});

test('subcategories work and safe deactivation rules are enforced', () => {
  const { tenantA, ownerA } = setup();
  db.setCurrentUser(ownerA);

  const parent = db.addCategory({ tenant_id: tenantA.id, name: 'Soft Drinks' });
  const child = db.addCategory({
    tenant_id: tenantA.id,
    name: 'Cola',
    parent_id: parent.category!.id,
  });
  assert.equal(child.success, true);

  // Cannot deactivate a parent with an active subcategory
  const early = db.setCategoryActive(parent.category!.id, false);
  assert.equal(early.success, false);

  // Deactivate child first, then parent
  assert.equal(db.setCategoryActive(child.category!.id, false).success, true);
  const parentOff = db.setCategoryActive(parent.category!.id, false);
  assert.equal(parentOff.success, true);
  assert.equal(parentOff.category?.is_active, false);
  assert.ok(parentOff.category?.deactivated_at, 'deactivation timestamp recorded');
  assert.equal(parentOff.category?.deactivated_by, ownerA.id, 'deactivator recorded');

  // Reactivation clears the audit fields
  const back = db.setCategoryActive(parent.category!.id, true);
  assert.equal(back.success, true);
  assert.equal(back.category?.deactivated_at, undefined);
});

test('deactivated categories preserve products but block new assignments', () => {
  const { tenantA, ownerA } = setup();
  db.setCurrentUser(ownerA);

  const cat = db.addCategory({ tenant_id: tenantA.id, name: 'Toiletries' });
  const product = addProductTo(tenantA.id, {
    category_id: cat.category!.id,
    category_name: cat.category!.name,
  });
  assert.equal(db.getProducts(tenantA.id).find((p) => p.id === product.id)?.category_name, 'Toiletries');

  assert.equal(db.setCategoryActive(cat.category!.id, false).success, true);

  // Existing product keeps its category and full history
  const kept = db.getProducts(tenantA.id).find((p) => p.id === product.id);
  assert.equal(kept?.category_id, cat.category!.id);
  assert.equal(db.getInventoryMovements(tenantA.id).some((m) => m.product_id === product.id), true);

  // New product silently refuses the deactivated category
  const stranded = addProductTo(tenantA.id, {
    category_id: cat.category!.id,
    category_name: 'Toiletries',
  });
  assert.equal(stranded.category_id, undefined);

  // Reassignment to the deactivated category is rejected
  assert.equal(db.updateProduct(stranded.id, { category_id: cat.category!.id }), false);

  // Reassignment to an active category works
  const fresh = db.addCategory({ tenant_id: tenantA.id, name: 'Household' });
  assert.equal(
    db.updateProduct(stranded.id, {
      category_id: fresh.category!.id,
      category_name: fresh.category!.name,
    }),
    true
  );
  assert.equal(
    db.getProducts(tenantA.id).find((p) => p.id === stranded.id)?.category_name,
    'Household'
  );
});

// ---------------------------------------------------------------------------
// Movement ledger + weighted-average cost
// ---------------------------------------------------------------------------

test('supplier receipt updates stock and weighted-average cost; ledger records balances', () => {
  const { tenantA, ownerA } = setup();
  db.setCurrentUser(ownerA);
  const product = addProductTo(tenantA.id, { stock_quantity: 20, cost_price: 10, avg_cost: 10 });

  const receipt = db.recordStockMovement({
    tenant_id: tenantA.id,
    product_id: product.id,
    type: 'restock',
    quantity: 10,
    unit_cost: 20,
    reason: 'Supplier receipt INV-778',
    reference_type: 'receipt',
  });
  assert.equal(receipt.success, true);

  const updated = db.getProducts(tenantA.id).find((p) => p.id === product.id)!;
  assert.equal(updated.stock_quantity, 30);
  // (20×10 + 10×20) / 30 = 13.3333
  assert.ok(Math.abs((updated.avg_cost ?? 0) - 400 / 30) < 0.001, `avg=${updated.avg_cost}`);

  const mov = receipt.movement!;
  assert.equal(mov.balance_after, 30);
  assert.ok(Math.abs((mov.unit_cost ?? 0) - 20) < 1e-9);
  assert.equal(mov.reference_type, 'receipt');
  assert.equal(mov.created_by, ownerA.id);
});

test('checkout deducts stock exactly once and creates one sale movement per item at WAC cost', () => {
  const { tenantA, ownerA } = setup();
  db.setCurrentUser(ownerA);
  const product = addProductTo(tenantA.id, { stock_quantity: 20, cost_price: 10, avg_cost: 10 });

  // Receipt raises WAC to 13.3333
  db.recordStockMovement({
    tenant_id: tenantA.id,
    product_id: product.id,
    type: 'restock',
    quantity: 10,
    unit_cost: 20,
  });

  const movementsBefore = db.getInventoryMovements(tenantA.id).length;

  const sale = db.processSale({
    tenant_id: tenantA.id,
    branch_id: 'branch-main',
    cashier_id: ownerA.id,
    cashier_name: ownerA.full_name,
    shop_name: 'Shop A',
    payment_method: 'cash',
    items: [{ productId: product.id, quantity: 5 }],
  });

  const updated = db.getProducts(tenantA.id).find((p) => p.id === product.id)!;
  assert.equal(updated.stock_quantity, 25, 'stock deducted exactly once');

  const saleMovements = db
    .getInventoryMovements(tenantA.id)
    .filter((m) => m.reference_id === sale.id && m.type === 'sale');
  assert.equal(saleMovements.length, 1, 'exactly one stock-out movement for the sale');
  assert.equal(saleMovements[0].balance_after, 25);
  assert.equal(
    db.getInventoryMovements(tenantA.id).length,
    movementsBefore + 1,
    'no extra movements created'
  );

  // COGS captured at weighted-average cost; WAC itself unchanged by the sale
  assert.ok(Math.abs(sale.cost_amount - 5 * (400 / 30)) < 0.02, `cogs=${sale.cost_amount}`);
  assert.ok(Math.abs((updated.avg_cost ?? 0) - 400 / 30) < 0.001);
  // Later purchases never rewrite this sale's historical cost
  db.recordStockMovement({
    tenant_id: tenantA.id,
    product_id: product.id,
    type: 'restock',
    quantity: 30,
    unit_cost: 50,
  });
  const saleItemCost = sale.items[0].cost_price;
  assert.ok(Math.abs(saleItemCost - 400 / 30) < 0.001, 'sale item cost snapshot preserved');
});

test('refunds restore stock with a refund movement', () => {
  const { tenantA, ownerA } = setup();
  db.setCurrentUser(ownerA);
  const product = addProductTo(tenantA.id, { stock_quantity: 20 });

  const sale = db.processSale({
    tenant_id: tenantA.id,
    branch_id: 'branch-main',
    cashier_id: ownerA.id,
    cashier_name: ownerA.full_name,
    shop_name: 'Shop A',
    payment_method: 'cash',
    items: [{ productId: product.id, quantity: 4 }],
  });
  assert.equal(db.getProducts(tenantA.id).find((p) => p.id === product.id)?.stock_quantity, 16);

  assert.equal(db.refundSale(sale.id, 'Customer changed mind'), true);
  const updated = db.getProducts(tenantA.id).find((p) => p.id === product.id)!;
  assert.equal(updated.stock_quantity, 20);

  const refunds = db
    .getInventoryMovements(tenantA.id)
    .filter((m) => m.type === 'refund' && m.reference_id === sale.id);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].balance_after, 20);

  // Double refund is blocked
  assert.equal(db.refundSale(sale.id), false);
});

test('manual movements: damage, expiry, signed adjustment; insufficient stock refused; cashiers blocked', () => {
  const { tenantA, ownerA, cashierA } = setup();
  const product = addProductTo(tenantA.id, { stock_quantity: 20 });

  db.setCurrentUser(cashierA);
  const denied = db.recordStockMovement({
    tenant_id: tenantA.id,
    product_id: product.id,
    type: 'damage',
    quantity: 5,
  });
  assert.equal(denied.success, false);

  db.setCurrentUser(ownerA);
  assert.equal(
    db.recordStockMovement({
      tenant_id: tenantA.id,
      product_id: product.id,
      type: 'damage',
      quantity: 5,
      reason: 'Broken in transit',
    }).success,
    true
  );
  assert.equal(
    db.recordStockMovement({
      tenant_id: tenantA.id,
      product_id: product.id,
      type: 'expired',
      quantity: 3,
    }).success,
    true
  );
  // Signed adjustment (+2 count correction)
  assert.equal(
    db.recordStockMovement({
      tenant_id: tenantA.id,
      product_id: product.id,
      type: 'adjustment',
      quantity: 2,
      reason: 'Physical count',
    }).success,
    true
  );
  assert.equal(db.getProducts(tenantA.id).find((p) => p.id === product.id)?.stock_quantity, 14);

  // Over-withdrawal refused (no silent clamping for manual movements)
  const tooMuch = db.recordStockMovement({
    tenant_id: tenantA.id,
    product_id: product.id,
    type: 'supplier_return',
    quantity: 999,
  });
  assert.equal(tooMuch.success, false);
  assert.ok(tooMuch.message?.includes('Insufficient stock'));
  assert.equal(db.getProducts(tenantA.id).find((p) => p.id === product.id)?.stock_quantity, 14);
});

test('reversals append signed corrections and cannot be double-reversed', () => {
  const { tenantA, ownerA } = setup();
  db.setCurrentUser(ownerA);
  const product = addProductTo(tenantA.id, { stock_quantity: 20 });

  const badReceipt = db.recordStockMovement({
    tenant_id: tenantA.id,
    product_id: product.id,
    type: 'restock',
    quantity: 10,
    unit_cost: 5,
    reason: 'Wrong entry',
  });
  assert.equal(db.getProducts(tenantA.id).find((p) => p.id === product.id)?.stock_quantity, 30);

  const reversal = db.reverseStockMovement(badReceipt.movement!.id, 'Correcting mis-keyed receipt');
  assert.equal(reversal.success, true);
  assert.equal(reversal.movement?.type, 'reversal');
  assert.equal(reversal.movement?.reversal_of, badReceipt.movement!.id);
  assert.equal(db.getProducts(tenantA.id).find((p) => p.id === product.id)?.stock_quantity, 20);

  // Original history preserved
  const original = db
    .getInventoryMovements(tenantA.id)
    .find((m) => m.id === badReceipt.movement!.id);
  assert.ok(original, 'original movement never deleted');
  assert.equal(original?.quantity, 10);

  // Cannot reverse twice
  assert.equal(db.reverseStockMovement(badReceipt.movement!.id).success, false);
});

// ---------------------------------------------------------------------------
// Stock Book API — restricted access + reconciliation
// ---------------------------------------------------------------------------

test('getStockBook is restricted to the shop owner and reconciles with the ledger', () => {
  const { tenantA, ownerA, cashierA } = setup();
  db.setCurrentUser(ownerA);
  const product = addProductTo(tenantA.id, {
    stock_quantity: 20,
    cost_price: 10,
    avg_cost: 10,
    name: 'Mineral Water',
  });
  db.recordStockMovement({
    tenant_id: tenantA.id,
    product_id: product.id,
    type: 'restock',
    quantity: 10,
    unit_cost: 20,
  });
  db.processSale({
    tenant_id: tenantA.id,
    branch_id: 'branch-main',
    cashier_id: ownerA.id,
    cashier_name: ownerA.full_name,
    shop_name: 'Shop A',
    payment_method: 'cash',
    items: [{ productId: product.id, quantity: 5 }],
  });

  const today = new Date().toISOString().slice(0, 10);
  const ok = db.getStockBook(tenantA.id, { from: today, to: today });
  assert.equal(ok.success, true);
  const entry = ok.data!.entries.find((e) => e.product.id === product.id)!;
  assert.equal(entry.currentStock, 25);
  assert.equal(entry.reconciles, true);
  // Value uses weighted-average cost, not selling price
  assert.ok(Math.abs(entry.currentValueAtCost - 25 * (400 / 30)) < 0.05);
  assert.ok(entry.currentValueAtCost < 25 * product.selling_price);

  // Cashier cannot retrieve the stock book / valuation
  db.setCurrentUser(cashierA);
  const denied = db.getStockBook(tenantA.id, { from: today, to: today });
  assert.equal(denied.success, false);
  assert.equal(denied.data, undefined);
});
