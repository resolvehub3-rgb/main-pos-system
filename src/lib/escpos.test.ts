import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReceiptBytes,
  bytesToBase64,
  COLUMNS,
  formatAmount,
  paperWidthFromSetting,
  toAscii,
  wrapText,
} from './escpos.ts';
import type { Sale, SaleItem, Tenant } from '../types/index.ts';

const tenant: Tenant = {
  id: 't1',
  name: 'Accra Fresh Mart',
  slug: 'accra-fresh-mart',
  phone: '0244123456',
  email: 'shop@example.com',
  address: '15 Oxford Street, Osu, Accra',
  currency: 'GHS',
  is_active: true,
  subscription_status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
};

const makeItem = (over: Partial<SaleItem> = {}): SaleItem => ({
  id: 'i1',
  sale_id: 's1',
  product_id: 'p1',
  product_name: 'Eva Water 500ml',
  barcode: '6001240100011',
  unit_price: 5,
  cost_price: 3,
  quantity: 2,
  discount_amount: 0,
  tax_amount: 0,
  total_amount: 10,
  ...over,
});

const makeSale = (over: Partial<Sale> = {}): Sale => ({
  id: 's1',
  tenant_id: 't1',
  branch_id: 'b1',
  cashier_id: 'c1',
  cashier_name: 'Kwame Mensah',
  shop_name: 'Accra Fresh Mart',
  invoice_number: 'INV-2026-000143',
  subtotal: 10,
  discount_amount: 0,
  tax_amount: 0,
  total_amount: 10,
  cost_amount: 6,
  payment_method: 'cash',
  payment_details: { cash_tendered: 20, change_due: 10 },
  status: 'completed',
  created_at: '2026-10-24T10:30:00.000Z',
  items: [makeItem()],
  ...over,
});

/**
 * Decode an ESC/POS stream to readable text, consuming control sequences
 * properly (commands take 0–2 argument bytes) so they don't pollute the output.
 */
function toText(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];

    if (byte === 0x0a) {
      out += '\n';
      i += 1;
      continue;
    }

    if (byte >= 0x20 && byte <= 0x7e) {
      out += String.fromCharCode(byte);
      i += 1;
      continue;
    }

    if (byte === 0x1b) {
      const cmd = bytes[i + 1];
      // ESC @ (init) takes no argument; ESC t/a/E/d each take one.
      i += cmd === 0x40 ? 2 : 3;
      continue;
    }

    if (byte === 0x1d) {
      const cmd = bytes[i + 1];
      // GS ! (size) takes one argument; GS V (cut) takes two (m, n).
      i += cmd === 0x56 ? 4 : 3;
      continue;
    }

    // Unknown byte — skip it rather than printing noise.
    i += 1;
  }
  return out;
}

/** Every printed line, with trailing padding trimmed for readability. */
function lines(bytes: Uint8Array): string[] {
  return toText(bytes)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
}

/* -------------------------------------------------------------------------- */

test('paperWidthFromSetting maps the terminal setting', () => {
  assert.equal(paperWidthFromSetting('58mm'), 58);
  assert.equal(paperWidthFromSetting('80mm'), 80);
});

test('toAscii folds accents and strips non-printable glyphs', () => {
  assert.equal(toAscii('Café'), 'Cafe');
  assert.equal(toAscii('Zoë'), 'Zoe');
  assert.equal(toAscii("Kwame’s ‘special’"), "Kwame's 'special'");
  assert.equal(toAscii('GH₵ 10.00'), 'GHS 10.00');
  assert.equal(toAscii('½ dozen 🇬🇭'), 'dozen');
  assert.equal(toAscii(null), '');
  assert.equal(toAscii(undefined), '');
  // Everything remaining must be printable ASCII.
  const sample = toAscii('Ñandú – “œuvre” … £5');
  for (const ch of sample) {
    const code = ch.charCodeAt(0);
    assert.ok(code >= 0x20 && code <= 0x7e, `non-ascii char U+${code.toString(16)}`);
  }
});

test('wrapText respects the column budget and never loses words', () => {
  const long = 'Goods sold are returnable within 48h with receipt';
  const wrapped = wrapText(long, 32);
  for (const line of wrapped) assert.ok(line.length <= 32, `line too long: "${line}"`);
  assert.equal(wrapped.join(' '), long);

  assert.deepEqual(wrapText('short', 32), ['short']);
  assert.deepEqual(wrapText('', 32), []);

  // A single token longer than the roll gets hard-broken, not dropped.
  const longUrl = 'https://example.com/a/very/long/path/that/exceeds/the/width';
  const url = wrapText(longUrl, 20);
  for (const line of url) assert.ok(line.length <= 20, `line too long: "${line}"`);
  assert.equal(url.join(''), longUrl.replace(/\s/g, ''));
});

test('formatAmount groups thousands and prefixes GHS', () => {
  assert.equal(formatAmount(48750), 'GHS 48,750.00');
  assert.equal(formatAmount(0), 'GHS 0.00');
  assert.equal(formatAmount(5.5), 'GHS 5.50');
  assert.equal(formatAmount(-1234.5), '-GHS 1,234.50');
  assert.equal(formatAmount(null), 'GHS 0.00');
  assert.equal(formatAmount(undefined), 'GHS 0.00');
  assert.equal(formatAmount(Number.NaN), 'GHS 0.00');
});

test('receipt starts with an init + code page sequence', () => {
  const bytes = buildReceiptBytes(makeSale(), tenant, 80);
  // ESC @ (init), ESC t 0 (PC437)
  assert.deepEqual(Array.from(bytes.slice(0, 5)), [0x1b, 0x40, 0x1b, 0x74, 0x00]);
});

test('receipt ends with feed + partial cut', () => {
  const bytes = buildReceiptBytes(makeSale(), tenant, 80);
  // ESC d 4 (feed 4 lines), then GS V 66 3 (partial cut, feed 3 first).
  assert.deepEqual(Array.from(bytes.slice(-7)), [
    0x1b, 0x64, 0x04,
    0x1d, 0x56, 0x42, 0x03,
  ]);
  assert.equal(bytes[bytes.length - 1], 0x03);
});

test('receipt contains the store, invoice, item and total details', () => {
  const text = toText(buildReceiptBytes(makeSale(), tenant, 80));
  assert.match(text, /Accra Fresh Mart/);
  assert.match(text, /15 Oxford Street, Osu, Accra/);
  assert.match(text, /Tel: 0244123456/);
  assert.match(text, /SUPERMARKET TAX INVOICE/);
  assert.match(text, /INV-2026-000143/);
  assert.match(text, /Kwame Mensah/);
  assert.match(text, /Eva Water 500ml/);
  assert.match(text, /2 x 5\.00/);
  assert.match(text, /TOTAL:/);
  assert.match(text, /GHS 10\.00/);
  assert.match(text, /Cash Tendered:/);
  assert.match(text, /Change Due:/);
  assert.match(text, /Thank you for shopping with us!/);
});

test('refunded line discounts and payment variants render', () => {
  const sale = makeSale({
    discount_amount: 2,
    tax_amount: 1,
    payment_method: 'mobile_money',
    payment_details: {
      momo_network: 'MTN MoMo',
      momo_number: '0244123456',
      momo_reference: 'MP261024.1430.A12345',
    },
    items: [makeItem({ product_name: 'Milo Tin 400g', quantity: 1, unit_price: 45, total_amount: 45 })],
    subtotal: 45,
    total_amount: 44,
  });

  const text = toText(buildReceiptBytes(sale, tenant, 80));
  assert.match(text, /Discount:/);
  assert.match(text, /Tax:/);
  assert.match(text, /MOBILE MONEY/);
  assert.match(text, /MTN MoMo/);
  assert.match(text, /MP261024\.1430\.A12345/);
  assert.match(text, /Milo Tin 400g/);
});

test('every printed line fits within the roll width', () => {
  for (const width of [58, 80] as const) {
    const sale = makeSale({
      items: [
        makeItem({ product_name: 'Indomie Instant Noodles Chicken Flavour Carton 40x70g', quantity: 3, unit_price: 12.5, total_amount: 37.5 }),
        makeItem({ product_name: 'Eva Water 500ml', quantity: 2, unit_price: 5, total_amount: 10 }),
        makeItem({ product_name: 'AMP 1000W Heater', quantity: 1, unit_price: 320, total_amount: 320 }),
      ],
      subtotal: 367.5,
      total_amount: 367.5,
      customer_name: 'Abena Owusu',
      invoice_number: 'INV-2026-999999',
      cashier_name: 'Very Long Cashier Name Example',
    });

    const budget = COLUMNS[width];
    for (const line of lines(buildReceiptBytes(sale, tenant, width))) {
      assert.ok(
        line.length <= budget,
        `${width}mm line too long (${line.length} > ${budget}): "${line}"`,
      );
    }
  }
});

test('long product names wrap instead of being truncated', () => {
  const sale = makeSale({
    items: [
      makeItem({
        product_name: 'Indomie Instant Noodles Chicken Flavour Carton 40x70g Extra Special',
        quantity: 3,
        unit_price: 12.5,
        total_amount: 37.5,
      }),
    ],
  });
  const text = toText(buildReceiptBytes(sale, tenant, 58));
  // The name must survive in full (across wrapped lines), not be cut short.
  assert.match(text.replace(/\s+/g, ' '), /Indomie Instant Noodles Chicken Flavour Carton 40x70g Extra Special/);
});

test('both paper widths produce lines exactly at or under budget', () => {
  for (const width of [58, 80] as const) {
    const text = toText(buildReceiptBytes(makeSale(), tenant, width));
    const longest = text.split('\n').reduce((max, l) => Math.max(max, l.length), 0);
    assert.ok(longest <= COLUMNS[width], `${width}mm longest line ${longest} > ${COLUMNS[width]}`);
  }
});

test('58mm and 80mm produce different column layouts', () => {
  const wide = toText(buildReceiptBytes(makeSale(), tenant, 80));
  const narrow = toText(buildReceiptBytes(makeSale(), tenant, 58));
  // The rules are '-' * columns, so lengths differ by the column budget.
  const ruleLen = (t: string) => (t.split('\n').find((l) => /^-{10,}$/.test(l)) || '').length;
  assert.equal(ruleLen(wide), 48);
  assert.equal(ruleLen(narrow), 32);
});

test('reprint of a refund keeps its own invoice and amounts intact', () => {
  const sale = makeSale({
    status: 'refunded',
    invoice_number: 'INV-2026-000100',
    total_amount: 90,
    subtotal: 90,
    items: [makeItem({ product_name: 'Refunded Item', quantity: 9, unit_price: 10, total_amount: 90 })],
  });
  const text = toText(buildReceiptBytes(sale, tenant, 80));
  assert.match(text, /INV-2026-000100/);
  assert.match(text, /Refunded Item/);
  assert.match(text, /GHS 90\.00/);
});

test('bytesToBase64 round-trips the byte stream', () => {
  const bytes = buildReceiptBytes(makeSale(), tenant, 58);
  const b64 = bytesToBase64(bytes);
  assert.ok(b64.length > 0);
  assert.match(b64, /^[A-Za-z0-9+/]+={0,2}$/);
  // Decode with Node's Buffer and compare.
  const decoded = Buffer.from(b64, 'base64');
  assert.deepEqual(Array.from(decoded), Array.from(bytes));
});

test('generated bytes are always 7-bit ASCII safe', () => {
  const sale = makeSale({
    items: [makeItem({ product_name: 'Café Néspresso – “Premium” 🇬🇭' })],
    cashier_name: 'Élise N’Krumah',
    customer_name: 'Ólúwá Sèwá',
  });
  const bytes = buildReceiptBytes(sale, tenant, 80);

  // No byte may exceed 0x7f — that would land in an unmapped code page slot.
  const high = Array.from(bytes).filter((b) => b > 0x7f);
  assert.deepEqual(high, [], `high bytes found: ${high.map((b) => b.toString(16))}`);

  // Every control byte present must be one this generator deliberately emits
  // (init, code page, align, bold, size, feed, cut) or a line feed.
  const allowedControls = new Set([
    0x0a, // line feed
    0x1b, // ESC
    0x1d, // GS
    0x00, 0x01, // command arguments (code page 0, align 0/1, bold 0/1, size 0x00/0x11)
    0x04, 0x03, // feed count, cut feed count
    0x21, 0x40, 0x42, 0x45, 0x61, 0x64, 0x74, // ! @ B E a d t sub-commands
    0x56, // V (cut)
    0x11, // double-size argument
  ]);
  const stray = Array.from(bytes).filter((b) => b < 0x20 && !allowedControls.has(b));
  assert.deepEqual(stray, [], `unexpected control bytes: ${stray.map((b) => b.toString(16))}`);

  // The decoded receipt must be pure printable ASCII.
  const text = toText(bytes);
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    assert.ok(
      (code >= 0x20 && code <= 0x7e) || ch === '\n',
      `non-ascii char in decoded receipt: U+${code.toString(16)}`,
    );
  }

  // Accents folded, currency readable, emoji gone.
  assert.match(text, /Cafe Nespresso/);
  assert.match(text, /Premium/);
  assert.match(text, /Elise N.Krumah/);
  assert.doesNotMatch(text, /🇬🇭/);
});

test('receipt is deterministic for identical input', () => {
  const a = buildReceiptBytes(makeSale(), tenant, 80);
  const b = buildReceiptBytes(makeSale(), tenant, 80);
  assert.deepEqual(Array.from(a), Array.from(b));
});
