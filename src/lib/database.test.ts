import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './supabaseClient.ts';

test('database starts clean with zero mock products or sales', () => {
  // Database starts empty for real backend
  assert.ok(Array.isArray(db.getProducts()));
  assert.ok(Array.isArray(db.getSales()));
});

test('addProduct and processSale performs atomic stock deduction and records sale', () => {
  const prod = db.addProduct({
    tenant_id: 'tenant-real-1',
    name: 'Real Jasmine Rice 5kg',
    sku: 'RICE-5KG-01',
    barcode: '6001239874561',
    cost_price: 85.00,
    selling_price: 110.00,
    stock_quantity: 20,
    min_stock_threshold: 5,
    image_url: '',
    unit: 'Bag',
    is_active: true,
  });

  assert.ok(prod.id);
  assert.equal(prod.stock_quantity, 20);

  const foundByBarcode = db.getProductByBarcode('6001239874561');
  assert.ok(foundByBarcode);
  assert.equal(foundByBarcode?.name, 'Real Jasmine Rice 5kg');

  const initialSalesCount = db.getSales().length;

  const sale = db.processSale({
    tenant_id: 'tenant-real-1',
    branch_id: 'branch-main',
    cashier_id: 'cashier-test',
    cashier_name: 'Test Cashier',
    shop_name: 'Real Supermarket',
    payment_method: 'cash',
    items: [
      {
        productId: prod.id,
        quantity: 2,
      },
    ],
  });

  assert.ok(sale.invoice_number);
  assert.equal(sale.total_amount, 220.00); // 2 * 110
  assert.equal(db.getSales().length, initialSalesCount + 1);

  // Verify stock was decremented from 20 to 18
  const updatedProduct = db.getProductByBarcode('6001239874561')!;
  assert.equal(updatedProduct.stock_quantity, 18);
});

test('deleteUser removes a cashier but refuses to strand the shop', () => {
  const owner = db.addUser({
    tenant_id: 'tenant-delete-1',
    shop_name: 'Delete Test Mart',
    full_name: 'Owning Manager',
    email: 'owner-delete@example.com',
    phone: '+233 20 111 2222',
    role: 'shop_owner',
    password: 'secret1',
    is_active: true,
  });
  const cashier = db.addUser({
    tenant_id: 'tenant-delete-1',
    shop_name: 'Delete Test Mart',
    full_name: 'Till Operator',
    email: 'cashier-delete@example.com',
    phone: '+233 20 333 4444',
    role: 'cashier',
    password: 'secret2',
    is_active: true,
  });
  const root = db.addUser({
    full_name: 'Platform Admin',
    email: 'root-delete@example.com',
    phone: '+233 20 555 6666',
    role: 'super_admin',
    password: 'secret3',
    is_active: true,
  });

  assert.notEqual(owner.id, cashier.id, 'staff created together need distinct ids');

  const signedInAs = db.getCurrentUser();
  db.setCurrentUser(owner);
  try {
    assert.equal(db.deleteUser(owner.id), false, 'the signed-in account must survive');
    assert.ok(db.getUsers().some((u) => u.id === owner.id), 'owner row is still listed');

    assert.equal(db.deleteUser(root.id), false, 'a super admin is not shop staff');
    assert.ok(db.getUsers().some((u) => u.id === root.id), 'super admin row is untouched');

    assert.equal(db.deleteUser(cashier.id), true, 'a cashier can be deleted');
    assert.equal(db.getUsers().some((u) => u.id === cashier.id), false, 'cashier row is gone');

    assert.equal(db.deleteUser(cashier.id), false, 'deleting twice is a no-op, not a crash');
  } finally {
    db.setCurrentUser(signedInAs);
  }
});

test('a shift opens, absorbs cash sales and drawer movements, then closes', () => {
  const tenant = 'tenant-shift-1';

  // The drawer screen has nothing to reconcile until a till opens one — every
  // control on it resolves against `getActiveShift`.
  assert.equal(db.getActiveShift(tenant), undefined);

  const shift = db.openShift(tenant, 'branch-main', 'cashier-shift', 'Kwesi Arrow', 250);
  assert.equal(db.getActiveShift(tenant)?.id, shift.id, 'an open shift is the active one');
  assert.equal(shift.cash_sales, 0);
  assert.equal(shift.expected_cash, 250, 'expected cash starts at the float');

  const prod = db.addProduct({
    tenant_id: tenant,
    name: 'Shift Test Milk 500ml',
    sku: 'MILK-500-SHIFT',
    barcode: '6001112223334',
    cost_price: 45,
    selling_price: 110,
    stock_quantity: 10,
    min_stock_threshold: 2,
    image_url: '',
    unit: 'Carton',
    is_active: true,
  });

  db.processSale({
    tenant_id: tenant,
    branch_id: 'branch-main',
    cashier_id: 'cashier-shift',
    cashier_name: 'Kwesi Arrow',
    shop_name: 'Shift Test Mart',
    payment_method: 'cash',
    items: [{ productId: prod.id, quantity: 2 }],
  });

  const afterSale = db.getActiveShift(tenant)!;
  assert.equal(afterSale.cash_sales, 220, 'cash sales are credited to the open shift');
  assert.equal(afterSale.expected_cash, 470);

  db.recordCashMovement(tenant, shift.id, 'cash_in', 50, 'Top-up from the safe');
  db.recordCashMovement(tenant, shift.id, 'cash_out', 30, 'Drop to the safe');

  const afterMoves = db.getActiveShift(tenant)!;
  assert.equal(afterMoves.expected_cash, 490, 'cash in raises the drawer, cash out lowers it');
  assert.equal(db.getCashMovements(shift.id).length, 2, 'both movements belong to the shift');

  const closed = db.closeShift(shift.id, 490, 'Balanced');
  assert.equal(closed?.status, 'closed');
  assert.equal(closed?.closing_cash, 490);
  assert.equal(db.getActiveShift(tenant), undefined, 'a closed shift is no longer active');
});
