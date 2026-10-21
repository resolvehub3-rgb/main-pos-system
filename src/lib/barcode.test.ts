import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidEan13,
  isValidUpcA,
  sanitizeBarcodeInput,
  detectBarcodeFormat,
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

test('sanitizeBarcodeInput trims and removes bad scanner noise', () => {
  assert.equal(sanitizeBarcodeInput(' 4006381333931\n\r'), '4006381333931');
  assert.equal(sanitizeBarcodeInput('PROD-1029-A '), 'PROD-1029-A');
});

test('detectBarcodeFormat classifies standard retail formats', () => {
  assert.equal(detectBarcodeFormat('4006381333931'), 'EAN-13');
  assert.equal(detectBarcodeFormat('036000291452'), 'UPC-A');
  assert.equal(detectBarcodeFormat('CODE128-ITEM-9'), 'CODE-128');
});
