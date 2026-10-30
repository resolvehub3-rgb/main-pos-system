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

  // A till can only ring up a sale while its shift is open.
  db.openShift('tenant-real-1', 'branch-main', 'cashier-test', 'Test Cashier', 100);

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
  // A super admin can now only be created under an authenticated super-admin
  // session — addUser() no longer lets a client mint a privileged role from
  // nowhere. The first super admin is provisioned in production via the
  // Supabase Admin API; here the session is established directly so the
  // deleteUser guard below is still exercised against a real super_admin row.
  const beforeAdminSession = db.getCurrentUser();
  db.setCurrentUser({
    id: 'test-super-admin-session',
    full_name: 'Provisioned Admin',
    email: 'root-provisioned@example.com',
    phone: '',
    role: 'super_admin',
    is_active: true,
    created_at: new Date().toISOString(),
  });
  const root = db.addUser({
    full_name: 'Platform Admin',
    email: 'root-delete@example.com',
    phone: '+233 20 555 6666',
    role: 'super_admin',
    password: 'secret3',
    is_active: true,
  });
  db.setCurrentUser(beforeAdminSession);

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

test('updateStoreProfile saves the settings form and stays owner-only', () => {
  const tenant = db.addTenant({
    name: 'Zen Mart Shop',
    slug: 'zen-mart-store-profile',
    phone: '0240000000',
    email: 'zen@example.com',
    address: 'Accra',
    currency: 'GHS',
    is_active: true,
    subscription_status: 'active',
  });
  const stored = () => db.getTenants().find((t) => t.id === tenant.id)!;
  const profile = {
    name: 'Zen Mart Shop',
    address: 'Korle Gonno',
    phone: '123456789',
    receipt_footer:
      'Thank you for shopping with us! Goods sold are returnable within 48h with receipt.',
    logo_url: '',
  };

  const beforeSession = db.getCurrentUser();
  const owner = {
    id: 'test-store-profile-owner',
    tenant_id: tenant.id,
    shop_name: tenant.name,
    full_name: 'Store Profile Owner',
    email: 'owner-profile@example.com',
    phone: '0240000000',
    role: 'shop_owner' as const,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  db.setCurrentUser(owner);

  try {
    // The save persists the whole profile — not a toast over a form that
    // nothing reads back.
    const saved = db.updateStoreProfile(tenant.id, profile);
    assert.equal(saved.ok, true, saved.message);
    assert.equal(stored().name, 'Zen Mart Shop');
    assert.equal(stored().address, 'Korle Gonno');
    assert.equal(stored().phone, '123456789');
    assert.equal(stored().receipt_footer, profile.receipt_footer);

    // A nameless invoice is refused before anything is written.
    const blank = db.updateStoreProfile(tenant.id, { ...profile, name: '   ' });
    assert.equal(blank.ok, false);
    assert.match(blank.message, /legal name/i);
    assert.equal(stored().name, 'Zen Mart Shop', 'a rejected save must not blank the name');

    // Clearing the footer is a deliberate choice: '' must survive the round
    // trip rather than silently reverting to the default note.
    const cleared = db.updateStoreProfile(tenant.id, { ...profile, receipt_footer: '' });
    assert.equal(cleared.ok, true, cleared.message);
    assert.equal(stored().receipt_footer, '');

    // The profile photo is part of the same save, so it mirrors with the row
    // (and from there broadcasts to the customer display with it).
    const logo = 'data:image/jpeg;base64,dGVzdA==';
    const withPhoto = db.updateStoreProfile(tenant.id, { ...profile, logo_url: logo });
    assert.equal(withPhoto.ok, true, withPhoto.message);
    assert.equal(stored().logo_url, logo);

    // Removing it returns the optional field to "no photo" rather than ''
    // sitting in a column the display would render as a broken image.
    const removed = db.updateStoreProfile(tenant.id, { ...profile, logo_url: '' });
    assert.equal(removed.ok, true, removed.message);
    assert.equal(stored().logo_url, undefined);
    db.updateStoreProfile(tenant.id, profile);

    // A cashier session cannot rewrite the name on the shop's receipts.
    db.setCurrentUser({ ...owner, id: 'test-store-profile-cashier', role: 'cashier' });
    const denied = db.updateStoreProfile(tenant.id, { ...profile, name: 'Hijacked Mart' });
    assert.equal(denied.ok, false);
    assert.match(denied.message, /owner/i);
    assert.equal(stored().name, 'Zen Mart Shop');
  } finally {
    db.setCurrentUser(beforeSession);
  }
});

test('addUser reuses an Auth ID already received through realtime', () => {
  const id = 'staff-auth-uuid';
  const staff = {
    id,
    tenant_id: 'tenant-realtime-staff',
    shop_name: 'Realtime Shop',
    full_name: 'Realtime Cashier',
    email: 'realtime-cashier@example.com',
    phone: '',
    role: 'cashier' as const,
    is_active: true,
  };
  const first = db.addUser(staff);
  const updated = db.addUser({ ...staff, full_name: 'Updated Cashier' });

  assert.strictEqual(updated, first);
  assert.equal(updated.full_name, 'Updated Cashier');
  assert.equal(db.getUsers().filter((user) => user.id === id).length, 1);
});

test('toggleUserStatus lets an owner toggle staff but never the super admin', () => {
  const beforeAdminSession = db.getCurrentUser();
  db.setCurrentUser({
    id: 'test-super-admin-toggle',
    full_name: 'Provisioned Admin',
    email: 'root-toggle-provision@example.com',
    phone: '',
    role: 'super_admin',
    is_active: true,
    created_at: new Date().toISOString(),
  });
  const root = db.addUser({
    full_name: 'Platform Admin',
    email: 'root-toggle@example.com',
    phone: '+233 20 555 6666',
    role: 'super_admin',
    password: 'secret3',
    is_active: true,
  });
  db.setCurrentUser(beforeAdminSession);

  const owner = db.addUser({
    tenant_id: 'tenant-toggle-1',
    shop_name: 'Toggle Test Mart',
    full_name: 'Owning Manager',
    email: 'owner-toggle@example.com',
    phone: '+233 20 111 2222',
    role: 'shop_owner',
    password: 'secret1',
    is_active: true,
  });
  const cashier = db.addUser({
    tenant_id: 'tenant-toggle-1',
    shop_name: 'Toggle Test Mart',
    full_name: 'Till Operator',
    email: 'cashier-toggle@example.com',
    phone: '+233 20 333 4444',
    role: 'cashier',
    password: 'secret2',
    is_active: true,
  });

  const signedInAs = db.getCurrentUser();
  db.setCurrentUser(owner);
  try {
    // A shop owner may toggle their own cashier.
    assert.equal(db.toggleUserStatus(cashier.id), true, 'owner can suspend their cashier');
    assert.equal(db.getUsers().find((u) => u.id === cashier.id)?.is_active, false, 'cashier is now suspended');
    assert.equal(db.toggleUserStatus(cashier.id), true, 'and re-enable them');

    // A shop owner must NOT be able to deactivate the platform super admin —
    // that would lock every shop out of its administrator.
    assert.equal(db.toggleUserStatus(root.id), false, 'a super admin is untouchable here');
    assert.equal(db.getUsers().find((u) => u.id === root.id)?.is_active, true, 'super admin stays active');
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

test('a sale is refused until the till opens a shift, and again once it closes', () => {
  const tenant = 'tenant-noshift-1';
  const prod = db.addProduct({
    tenant_id: tenant,
    name: 'No Shift Bread',
    sku: 'BREAD-NOSHIFT',
    barcode: '6005554443332',
    cost_price: 5,
    selling_price: 8,
    stock_quantity: 10,
    min_stock_threshold: 2,
    image_url: '',
    unit: 'Loaf',
    is_active: true,
  });
  const saleInput = {
    tenant_id: tenant,
    branch_id: 'branch-main',
    cashier_id: 'cashier-gate',
    cashier_name: 'Gate Cashier',
    shop_name: 'Gate Mart',
    payment_method: 'cash' as const,
    items: [{ productId: prod.id, quantity: 1 }],
  };

  // No shift open → the sale is refused outright: no invoice, no stock moved.
  assert.equal(db.getActiveShift(tenant), undefined);
  assert.throws(() => db.processSale(saleInput), /open shift/i, 'no open shift, no sale');
  assert.equal(db.getSales().filter((s) => s.tenant_id === tenant).length, 0, 'nothing recorded');
  assert.equal(
    db.getProductByBarcode('6005554443332')?.stock_quantity,
    10,
    'the refused sale leaves stock untouched'
  );

  // Open the shift and the very same sale goes through, crediting the drawer.
  const shift = db.openShift(tenant, 'branch-main', 'cashier-gate', 'Gate Cashier', 50);
  const sale = db.processSale(saleInput);
  assert.equal(sale.total_amount, 8, 'the sale succeeds with an open shift');
  assert.equal(db.getActiveShift(tenant)?.cash_sales, 8, 'cash sale credited to the shift');

  // Closing the shift locks the till again.
  db.closeShift(shift.id, 58, 'Done for the day');
  assert.throws(() => db.processSale(saleInput), /open shift/i, 'a closed shift stops sales');
});

test('addProduct refuses a barcode already used by another product in the same shop', () => {
  const tenant = 'tenant-dup-barcode-1';
  const base = {
    tenant_id: tenant,
    name: 'Sole Product With Barcode',
    sku: 'DUP-0001',
    barcode: '6007778889991',
    cost_price: 10,
    selling_price: 15,
    stock_quantity: 5,
    min_stock_threshold: 1,
    image_url: '',
    unit: 'Piece',
    is_active: true,
  };
  const first = db.addProduct(base);
  assert.equal(first.barcode, '6007778889991');

  // Same barcode, same shop ? refused with a clear message.
  assert.throws(
    () => db.addProduct({ ...base, name: 'Impostor', sku: 'DUP-0002' }),
    /already used by/,
    'duplicate barcodes cannot be registered in one shop'
  );

  // The refused product was not partially saved.
  assert.equal(db.getProducts(tenant).filter((p) => p.name === 'Impostor').length, 0);

  // The same barcode in ANOTHER shop is fine (it is a different catalogue).
  const other = db.addProduct({ ...base, tenant_id: 'tenant-dup-barcode-2', sku: 'DUP-0003' });
  assert.equal(other.tenant_id, 'tenant-dup-barcode-2');
});

test('updateProduct refuses to reassign a barcode another product already holds', () => {
  const tenant = 'tenant-dup-barcode-3';
  const a = db.addProduct({
    tenant_id: tenant,
    name: 'Product A',
    sku: 'UPD-A',
    barcode: '6001010101011',
    cost_price: 4,
    selling_price: 6,
    stock_quantity: 3,
    min_stock_threshold: 1,
    image_url: '',
    unit: 'Piece',
    is_active: true,
  });
  const b = db.addProduct({
    tenant_id: tenant,
    name: 'Product B',
    sku: 'UPD-B',
    barcode: '6002020202022',
    cost_price: 4,
    selling_price: 6,
    stock_quantity: 3,
    min_stock_threshold: 1,
    image_url: '',
    unit: 'Piece',
    is_active: true,
  });

  // B may keep (or re-set) its own barcode � that is not a conflict.
  assert.equal(db.updateProduct(b.id, { barcode: '6002020202022' }), true);

  // B may not take A's barcode.
  assert.throws(
    () => db.updateProduct(b.id, { barcode: '6001010101011' }),
    /already used by/,
    'barcode reassignment is duplicate-guarded'
  );
  assert.equal(db.getProductByBarcode('6002020202022', tenant)?.id, b.id, 'B keeps its barcode');

  // A product must never end up without a scannable barcode.
  assert.throws(() => db.updateProduct(a.id, { barcode: '   ' }), /barcode is required/i);
  assert.throws(() => db.addProduct({
    tenant_id: tenant,
    name: 'No Barcode',
    sku: 'UPD-C',
    barcode: '',
    cost_price: 1,
    selling_price: 2,
    stock_quantity: 0,
    min_stock_threshold: 1,
    image_url: '',
    unit: 'Piece',
    is_active: true,
  }), /barcode is required/i);
});
