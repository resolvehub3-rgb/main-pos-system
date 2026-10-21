/**
 * Barcode utilities for Retail POS (EAN-13, UPC-A, Code 128)
 */

/**
 * Validates EAN-13 check digit
 */
export function isValidEan13(barcode: string): boolean {
  const clean = barcode.trim();
  if (!/^\d{13}$/.test(clean)) return false;

  const digits = clean.split('').map(Number);
  const checkDigit = digits[12];

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += i % 2 === 0 ? digits[i] : digits[i] * 3;
  }

  const calculatedCheck = (10 - (sum % 10)) % 10;
  return checkDigit === calculatedCheck;
}

/**
 * Validates UPC-A check digit
 */
export function isValidUpcA(barcode: string): boolean {
  const clean = barcode.trim();
  if (!/^\d{12}$/.test(clean)) return false;

  const digits = clean.split('').map(Number);
  const checkDigit = digits[11];

  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += i % 2 === 0 ? digits[i] * 3 : digits[i];
  }

  const calculatedCheck = (10 - (sum % 10)) % 10;
  return checkDigit === calculatedCheck;
}

/**
 * Sanitizes and normalizes barcode input from USB/Bluetooth scanner or keyboard
 */
export function sanitizeBarcodeInput(input: string): string {
  // Remove non-alphanumeric characters except standard retail dashes
  return input.trim().replace(/[^\w-]/g, '');
}

/**
 * Determines standard barcode format
 */
export function detectBarcodeFormat(barcode: string): 'EAN-13' | 'UPC-A' | 'CODE-128' | 'CUSTOM' {
  const clean = sanitizeBarcodeInput(barcode);
  if (/^\d{13}$/.test(clean) && isValidEan13(clean)) return 'EAN-13';
  if (/^\d{12}$/.test(clean) && isValidUpcA(clean)) return 'UPC-A';
  if (/^[A-Za-z0-9_-]{4,20}$/.test(clean)) return 'CODE-128';
  return 'CUSTOM';
}
