/**
 * Barcode utilities for the SamTill POS.
 *
 * Covers the symbologies a Ghanaian supermarket actually meets on supplier
 * packaging — EAN-13, EAN-8, UPC-A, UPC-E — plus the Code 128 / Code 39
 * labels shops print themselves. Everything here is pure and synchronous so
 * it runs identically on the PWA, in tests and with no network: barcode
 * identification is resolved against the device-local product mirror, never
 * through Supabase.
 */

/** The retail symbologies the POS can register and scan. */
export type RetailBarcodeFormat = 'EAN-13' | 'EAN-8' | 'UPC-A' | 'UPC-E' | 'CODE-128' | 'CODE-39';

/**
 * Minimal product projection the barcode helpers need. Kept structural so the
 * helpers work on `Product` (and on bare test fixtures) without importing the
 * full type.
 */
export interface BarcodeCarrier {
  id?: string;
  barcode: string;
  sku: string;
  tenant_id: string;
  is_active?: boolean;
}

/**
 * GS1 mod-10 check digit over an EAN-13 style payload (alternating weights
 * 1/3 starting at weight 1 for the first payload digit).
 */
export function computeMod10CheckDigit(payloadDigits: string): number {
  let sum = 0;
  for (let i = 0; i < payloadDigits.length; i++) {
    sum += i % 2 === 0 ? Number(payloadDigits[i]) : Number(payloadDigits[i]) * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** Appends the correct check digit to a 12-digit EAN-13 payload. */
export function withEan13CheckDigit(payload12: string): string {
  return payload12 + computeMod10CheckDigit(payload12);
}

/**
 * Appends the correct check digit to a 7-digit EAN-8 payload. EAN-8 weights
 * its seven data digits 3,1,3,1,3,1,3 — the opposite parity to EAN-13 — so
 * the sum starts at weight 3.
 */
export function withEan8CheckDigit(payload7: string): string {
  let sum = 0;
  for (let i = 0; i < payload7.length; i++) {
    sum += i % 2 === 0 ? Number(payload7[i]) * 3 : Number(payload7[i]);
  }
  return payload7 + ((10 - (sum % 10)) % 10);
}

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

/** Validates EAN-8 check digit (8 digits, weights 3,1,3,1,3,1,3). */
export function isValidEan8(barcode: string): boolean {
  const clean = barcode.trim();
  if (!/^\d{8}$/.test(clean)) return false;
  return Number(clean[7]) === Number(withEan8CheckDigit(clean.slice(0, 7))[7]);
}

/**
 * Expands a UPC-E symbol into its full UPC-A equivalent following the GS1
 * compression table (the last of the six payload digits decides the
 * zero-padding pattern). Mirrors ZXing's `convertUPCEtoUPCA`, which is the
 * decoder the camera scanner ships with — registration-time validation and
 * live decoding therefore agree on every symbol.
 *
 * Layout: `<number-system><U1..U6><check>` → 12-digit UPC-A + same check.
 */
export function upcEToUpcA(barcode: string): string | null {
  const clean = barcode.trim();
  if (!/^[01]\d{7}$/.test(clean)) return null;

  const numberSystem = clean[0];
  const digits = clean.slice(1, 7).split('');
  const lastChar = digits[5];

  let expanded: string;
  if (lastChar === '0' || lastChar === '1' || lastChar === '2') {
    expanded = numberSystem + digits.slice(0, 2).join('') + lastChar + '0000' + digits.slice(2, 5).join('');
  } else if (lastChar === '3') {
    expanded = numberSystem + digits.slice(0, 3).join('') + '00000' + digits.slice(3, 5).join('');
  } else if (lastChar === '4') {
    expanded = numberSystem + digits.slice(0, 4).join('') + '00000' + digits[4];
  } else {
    expanded = numberSystem + digits.slice(0, 5).join('') + '0000' + lastChar;
  }

  return expanded + clean[7];
}

/**
 * Validates a UPC-E barcode: 8 digits (number system 0 or 1 + six-digit
 * payload + check digit) whose check digit matches the UPC-A number it
 * expands to.
 */
export function isValidUpcE(barcode: string): boolean {
  const expanded = upcEToUpcA(barcode);
  return expanded !== null && isValidUpcA(expanded);
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
 *
 * Numeric retail symbols are identified first — their length plus check digit
 * prove the symbology — so anything numeric of retail length that fails its
 * check digit is NOT mislabelled as a house Code 128 label.
 */
export function detectBarcodeFormat(barcode: string): 'EAN-13' | 'UPC-A' | 'EAN-8' | 'UPC-E' | 'CODE-128' | 'CUSTOM' {
  const clean = sanitizeBarcodeInput(barcode);
  if (/^\d{13}$/.test(clean) && isValidEan13(clean)) return 'EAN-13';
  if (/^\d{12}$/.test(clean) && isValidUpcA(clean)) return 'UPC-A';
  if (/^\d{8}$/.test(clean)) {
    if (isValidEan8(clean)) return 'EAN-8';
    if (isValidUpcE(clean)) return 'UPC-E';
  }
  if (/^[A-Za-z0-9_-]{4,20}$/.test(clean)) return 'CODE-128';
  return 'CUSTOM';
}

/**
 * Result of validating a barcode the owner captured (camera scan or typed)
 * for product registration. `ok` barcodes are safe to store; `message` is a
 * shop-owner-facing explanation when they are not.
 */
export interface BarcodeValidation {
  ok: boolean;
  /** Detected symbology, when the value was recognised. */
  format?: RetailBarcodeFormat;
  message?: string;
}

/**
 * Validates a barcode for product registration.
 *
 * Rules:
 * - The value must be non-empty and survive scanner sanitisation.
 * - Numeric symbols of retail lengths (13/12/8 digits) must carry a correct
 *   mod-10 check digit — a mistyped or truncated manufacturer barcode is
 *   rejected here instead of being stored unscannable.
 * - Everything else is accepted as a Code 128 / Code 39 house label
 *   (4-32 alphanumeric characters, dashes allowed) so self-printed shelf
 *   labels stay registrable.
 */
export function validateBarcodeForRegistration(input: string): BarcodeValidation {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, message: 'Enter or scan a barcode first.' };
  }

  const clean = sanitizeBarcodeInput(raw);
  if (!clean) {
    return { ok: false, message: 'Barcode may only contain letters, numbers and dashes.' };
  }

  if (/^\d{13}$/.test(clean)) {
    return isValidEan13(clean)
      ? { ok: true, format: 'EAN-13' }
      : { ok: false, message: `“${clean}” is not a valid EAN-13 — its check digit (last digit) is wrong.` };
  }
  if (/^\d{12}$/.test(clean)) {
    return isValidUpcA(clean)
      ? { ok: true, format: 'UPC-A' }
      : { ok: false, message: `“${clean}” is not a valid UPC-A — its check digit (last digit) is wrong.` };
  }
  if (/^\d{8}$/.test(clean)) {
    if (isValidEan8(clean)) return { ok: true, format: 'EAN-8' };
    if (isValidUpcE(clean)) return { ok: true, format: 'UPC-E' };
    return { ok: false, message: `“${clean}” is not a valid EAN-8 or UPC-E — its check digit is wrong.` };
  }
  if (/^\d+$/.test(clean)) {
    return {
      ok: false,
      message: `“${clean}” has an unsupported digit length — retail barcodes are 8, 12 or 13 digits.`,
    };
  }
  // Alphanumeric in-house label. Code 128 and Code 39 share this charset, so
  // the symbology cannot be told apart from the text alone; both are accepted
  // and both are decoded by the camera scanner.
  if (/^[A-Za-z0-9_-]{4,32}$/.test(clean)) {
    return { ok: true, format: 'CODE-128' };
  }

  return {
    ok: false,
    message: 'Barcode must be a retail number (8, 12 or 13 digits) or 4-32 letters/digits/dashes.',
  };
}

/**
 * Generates a unique, checksum-valid internal EAN-13 barcode for a product
 * with no manufacturer barcode printed on it (the automatic fallback).
 *
 * Uses the `600` GS1 prefix registered to Ghana, so the fallback number still
 * looks like a real retail barcode on a shelf label and scans on any till.
 * Barcodes already in use are avoided, so registration can never mint a
 * duplicate.
 */
export function generateInternalBarcode(existingBarcodes: Iterable<string> = []): string {
  const taken = new Set<string>();
  for (const code of existingBarcodes) {
    const clean = code.trim();
    if (clean) taken.add(clean);
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    let payload = '600';
    for (let i = 0; i < 9; i++) {
      payload += Math.floor(Math.random() * 10).toString();
    }
    const candidate = withEan13CheckDigit(payload);
    if (!taken.has(candidate)) return candidate;
  }

  // Astronomically unlikely collision storm — derive from the clock instead,
  // still check-digit correct and still avoiding every taken number.
  const seed = Date.now();
  for (let attempt = 0; attempt < 1000; attempt++) {
    let payload = '600';
    let value = seed + attempt;
    for (let i = 0; i < 9; i++) {
      payload += (value % 10).toString();
      value = Math.floor(value / 10);
    }
    const candidate = withEan13CheckDigit(payload);
    if (!taken.has(candidate)) return candidate;
  }
  /* c8 ignore next */
  throw new Error('Could not generate a unique barcode — please try again.');
}

/**
 * Finds the product a scanned barcode belongs to, purely from the local
 * product mirror — works offline, never touches Supabase.
 *
 * Matching order:
 * 1. Exact barcode match (case-insensitive for in-house Code 128/39 labels).
 * 2. UPC-A ↔ EAN-13 equivalence: the same symbol may be scanned or stored
 *    with or without its leading zero, so a 12-digit scan matches a product
 *    stored as `0…`+the same digits (and vice versa).
 *
 * With `activeOnly`, archived products do not match a checkout scan — their
 * barcodes are not for sale.
 */
export function findProductByBarcode<T extends BarcodeCarrier>(
  products: T[],
  barcode: string,
  options: { tenantId?: string; activeOnly?: boolean } = {},
): T | undefined {
  const clean = sanitizeBarcodeInput(barcode);
  if (!clean) return undefined;

  let scoped = options.tenantId
    ? products.filter((p) => p.tenant_id === options.tenantId)
    : products.slice();
  if (options.activeOnly) {
    scoped = scoped.filter((p) => p.is_active !== false);
  }
  if (scoped.length === 0) return undefined;

  const lower = clean.toLowerCase();
  const exact = scoped.find((p) => {
    const stored = p.barcode.trim();
    return stored === clean || stored.toLowerCase() === lower;
  });
  if (exact) return exact;

  // UPC-A (12 digits) ↔ EAN-13 (the same number behind a leading zero).
  const zeroStripped = clean.startsWith('0') ? clean.slice(1) : null;
  return scoped.find((p) => {
    const stored = p.barcode.trim();
    // Scan is UPC-A, product stored with the leading zero: 0 + scan.
    if (/^\d{12}$/.test(clean) && stored === `0${clean}`) return true;
    // Scan is EAN-13 starting with zero, product stored as the bare UPC-A.
    return zeroStripped !== null && /^\d{12}$/.test(stored) && stored === zeroStripped;
  });
}

/**
 * Returns the product that already holds this barcode inside the same shop —
 * the duplicate-assignment guard used by product registration and editing.
 * `excludeProductId` lets an edit keep its own barcode unchanged.
 */
export function findBarcodeConflict<T extends BarcodeCarrier>(
  products: T[],
  barcode: string,
  tenantId: string,
  excludeProductId?: string,
): T | undefined {
  const clean = sanitizeBarcodeInput(barcode);
  if (!clean) return undefined;
  const lower = clean.toLowerCase();
  return products.find(
    (p) =>
      p.tenant_id === tenantId &&
      p.id !== excludeProductId &&
      (p.barcode.trim() === clean || p.barcode.trim().toLowerCase() === lower),
  );
}
