import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidEan13,
  isValidUpcA,
  isValidEan8,
  isValidUpcE,
  upcEToUpcA,
  withEan13CheckDigit,
  withEan8CheckDigit,
  sanitizeBarcodeInput,
  detectBarcodeFormat,
  validateBarcodeForRegistration,
  generateInternalBarcode,
  findProductByBarcode,
  findBarcodeConflict,
} from './barcode.ts';

test('isValidEan13 validates valid and invalid EAN-13 barcodes', () => {
  // Valid EAN-13: 4006381333931
  assert.equal(isValidEan13('4006381333931'), true);
  // Invalid check digit:
  assert.equal(isValidEan13('4006381333932'), false);
  // Invalid length:
  assert.equal(isValidEan13('12345'), false);
});

test('isValidUpcA validates valid and invalid UPC-A barcodes', () => {
  // Valid UPC-A: 036000291452
  assert.equal(isValidUpcA('036000291452'), true);
  // Invalid check digit:
  assert.equal(isValidUpcA('036000291459'), false);
});

test('isValidEan8 validates valid and invalid EAN-8 barcodes', () => {
  // Valid EAN-8: 96385074
  assert.equal(isValidEan8('96385074'), true);
  // Invalid check digit:
  assert.equal(isValidEan8('96385075'), false);
  // Too short:
  assert.equal(isValidEan8('9638507'), false);
});

test('isValidUpcE validates valid and invalid UPC-E barcodes', () => {
  // 04252614 expands to the valid UPC-A 042100005264.
  assert.equal(upcEToUpcA('04252614'), '042100005264');
  assert.equal(isValidUpcE('04252614'), true);
  // Every GS1 compression branch: last payload digit 3, 4 and 5-9.
  assert.equal(isValidUpcE('01234434'), true); // …00000X form
  assert.equal(isValidUpcE('01234543'), true); // …00000 form
  assert.equal(isValidUpcE('01234596'), true); // …000 form
  // Wrong check digit:
  assert.equal(isValidUpcE('01234597'), false);
  // Number system must be 0 or 1:
  assert.equal(isValidUpcE('91234596'), false);
});

test('withEan13CheckDigit and withEan8CheckDigit append correct check digits', () => {
  assert.equal(withEan13CheckDigit('400638133393'), '4006381333931');
  assert.equal(withEan8CheckDigit('9638507'), '96385074');
  // Generated numbers always pass their own validators.
  assert.equal(isValidEan13(withEan13CheckDigit('600123456789')), true);
  assert.equal(isValidEan8(withEan8CheckDigit('6012345')), true);
});

test('sanitizeBarcodeInput trims and removes bad scanner noise', () => {
  assert.equal(sanitizeBarcodeInput(' 4006381333931\n\r'), '4006381333931');
  assert.equal(sanitizeBarcodeInput('PROD-1029-A '), 'PROD-1029-A');
});

test('detectBarcodeFormat classifies standard retail formats', () => {
  assert.equal(detectBarcodeFormat('4006381333931'), 'EAN-13');
  assert.equal(detectBarcodeFormat('036000291452'), 'UPC-A');
  assert.equal(detectBarcodeFormat('96385074'), 'EAN-8');
  // An 8-digit symbol whose digits are only valid as UPC-E (some 8-digit
  // strings satisfy both symbologies — the real one is told apart by its
  // printed guard patterns, and EAN-8 wins the tie here).
  assert.equal(detectBarcodeFormat('04252614'), 'UPC-E');
  assert.equal(detectBarcodeFormat('CODE128-ITEM-9'), 'CODE-128');
});

test('validateBarcodeForRegistration accepts every supported symbology', () => {
  assert.equal(validateBarcodeForRegistration('4006381333931').format, 'EAN-13');
  assert.equal(validateBarcodeForRegistration('036000291452').format, 'UPC-A');
  assert.equal(validateBarcodeForRegistration('96385074').format, 'EAN-8');
  assert.equal(validateBarcodeForRegistration('04252614').format, 'UPC-E');
  assert.equal(validateBarcodeForRegistration('MILK-500').format, 'CODE-128');
  assert.equal(validateBarcodeForRegistration('BREAD0042').format, 'CODE-128');
  // Scanner input carries stray whitespace / carriage returns.
  const scanned = validateBarcodeForRegistration(' 4006381333931\r\n');
  assert.equal(scanned.ok, true);
  assert.equal(scanned.format, 'EAN-13');
});

test('validateBarcodeForRegistration rejects bad check digits and junk', () => {
  // 13 digits with a wrong check digit must NOT be accepted as-is.
  const badEan13 = validateBarcodeForRegistration('4006381333932');
  assert.equal(badEan13.ok, false);
  assert.match(badEan13.message ?? '', /EAN-13/);
  // 12 digits with a wrong check digit.
  const badUpc = validateBarcodeForRegistration('036000291459');
  assert.equal(badUpc.ok, false);
  assert.match(badUpc.message ?? '', /UPC-A/);
  // Unsupported digit length (9 digits).
  assert.equal(validateBarcodeForRegistration('123456789').ok, false);
  // Empty and symbol-only input.
  assert.equal(validateBarcodeForRegistration('').ok, false);
  assert.equal(validateBarcodeForRegistration('   ').ok, false);
  assert.equal(validateBarcodeForRegistration('!@#$%').ok, false);
});

test('generateInternalBarcode mints a valid, unique Ghana-prefix EAN-13', () => {
  const existing = ['4006381333931', '036000291452'];
  const seen = new Set<string>(existing);
  for (let i = 0; i < 200; i++) {
    const code = generateInternalBarcode(existing);
    assert.equal(isValidEan13(code), true, `${code} must be checksum-valid`);
    assert.ok(code.startsWith('600'), 'internal barcodes use the GS1 Ghana prefix');
    assert.equal(seen.has(code), false, `${code} must never duplicate`);
    seen.add(code);
  }
  // A shop that already owns barcodes cannot receive a collision.
  const mine = generateInternalBarcode(['6000000000000', '6001111111111']);
  assert.notEqual(mine, '6000000000000');
  assert.notEqual(mine, '6001111111111');
});

const catalogue = [
  { id: 'p1', barcode: '4006381333931', sku: 'RICE-5KG', tenant_id: 'shop-a', is_active: true },
  { id: 'p2', barcode: '036000291452', sku: 'SOUP-CAN', tenant_id: 'shop-a', is_active: true },
  { id: 'p3', barcode: 'MILK-500', sku: 'MILK-SKU', tenant_id: 'shop-a', is_active: true },
  { id: 'p4', barcode: '96385074', sku: 'JUICE-1L', tenant_id: 'shop-b', is_active: true },
  { id: 'p5', barcode: '042100005264', sku: 'TEA-20', tenant_id: 'shop-a', is_active: false },
  // Same symbol as p2's UPC-A but stored in its 13-digit EAN-13 form, in the
  // other shop — proves lookup follows the barcode, not the digit count.
  { id: 'p6', barcode: '0036000291452', sku: 'SOUP-EAN', tenant_id: 'shop-b', is_active: true },
];

test('findProductByBarcode matches exactly and scopes to the shop', () => {
  assert.equal(findProductByBarcode(catalogue, '4006381333931', { tenantId: 'shop-a' })?.id, 'p1');
  // Another shop's barcode never matches.
  assert.equal(findProductByBarcode(catalogue, '96385074', { tenantId: 'shop-a' }), undefined);
  // In-house Code 39/128 labels match case-insensitively.
  assert.equal(findProductByBarcode(catalogue, 'milk-500', { tenantId: 'shop-a' })?.id, 'p3');
  // Scanner noise around the digits is stripped first.
  assert.equal(findProductByBarcode(catalogue, ' 4006381333931\r\n', { tenantId: 'shop-a' })?.id, 'p1');
});

test('findProductByBarcode treats UPC-A and its EAN-13 form as one symbol', () => {
  // Product stored as the bare 12-digit UPC-A, scanner sends its 13-digit
  // EAN-13 form (some scanners add the leading zero).
  assert.equal(
    findProductByBarcode(catalogue, '0042100005264', { tenantId: 'shop-a', activeOnly: false })?.id,
    'p5'
  );
  // Product stored in the 13-digit EAN-13 form, scanner sends bare UPC-A.
  assert.equal(
    findProductByBarcode(catalogue, '036000291452', { tenantId: 'shop-b' })?.id,
    'p6'
  );
  // The same 13-digit scan in the owning shop resolves by exact match.
  assert.equal(findProductByBarcode(catalogue, '0036000291452', { tenantId: 'shop-b' })?.id, 'p6');
});

test('findProductByBarcode skips archived products when selling', () => {
  // p5 is archived: a checkout scan must not find it…
  assert.equal(findProductByBarcode(catalogue, '042100005264', { tenantId: 'shop-a', activeOnly: true }), undefined);
  // …but a lookup without the flag still resolves it (e.g. audit/history).
  assert.equal(findProductByBarcode(catalogue, '042100005264', { tenantId: 'shop-a' })?.id, 'p5');
});

test('findBarcodeConflict flags duplicate assignments inside one shop', () => {
  // Same shop, same barcode → conflict.
  assert.equal(findBarcodeConflict(catalogue, '4006381333931', 'shop-a')?.id, 'p1');
  // Editing p1 and keeping its own barcode is NOT a conflict.
  assert.equal(findBarcodeConflict(catalogue, '4006381333931', 'shop-a', 'p1'), undefined);
  // Reassigning p3 to p1's barcode IS.
  assert.equal(findBarcodeConflict(catalogue, '4006381333931', 'shop-a', 'p3')?.id, 'p1');
  // The same barcode in a different shop is free to use.
  assert.equal(findBarcodeConflict(catalogue, '96385074', 'shop-a'), undefined);
  // Case-insensitive for in-house labels.
  assert.equal(findBarcodeConflict(catalogue, 'milk-500', 'shop-a', 'p3'), undefined);
  assert.equal(findBarcodeConflict(catalogue, 'MILK-500', 'shop-a')?.id, 'p3');
  // Blank input never conflicts.
  assert.equal(findBarcodeConflict(catalogue, '   ', 'shop-a'), undefined);
});
