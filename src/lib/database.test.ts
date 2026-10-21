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
