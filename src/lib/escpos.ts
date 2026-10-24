/**
 * ESC/POS thermal receipt generator.
 *
 * Turns a `Sale` + `Tenant` into the raw byte stream a thermal printer expects,
 * so the receipt can be sent straight to the hardware instead of through the
 * browser's print dialog.
 *
 * Everything emitted here is plain 7-bit ASCII (see `toAscii`), which renders
 * correctly on any thermal printer regardless of its selected code page.
 *
 * Pure functions only — no DOM, no network — so it runs identically in the
 * browser (checkout flow) and in Node (tests / print bridge).
 */
import type { Sale, Tenant } from '../types';

/** Printable paper width in millimetres. Drives the column count. */
export type PaperWidth = 58 | 80;

/** Characters per line for font A (12x24) — the standard for each roll size. */
export const COLUMNS: Record<PaperWidth, number> = {
  58: 32,
  80: 48,
};

/** Maps the terminal setting string onto a printable paper width. */
export function paperWidthFromSetting(setting: '58mm' | '80mm'): PaperWidth {
  return setting === '58mm' ? 58 : 80;
}

/* -------------------------------------------------------------------------- */
/* ESC/POS command sequences                                                   */
/* -------------------------------------------------------------------------- */

const ESC = 0x1b;
const GS = 0x1d;

/** Initialise the printer (clears buffers, defaults, kills any pending job). */
const CMD_INIT = [ESC, 0x40];
/** `ESC t n` — select code page. 0 = PC437 (ASCII superset, always safe). */
const CMD_CODEPAGE = [ESC, 0x74, 0x00];
/** `GS ! n` — character size; 0x11 = double width + double height. */
const charSize = (n: number): number[] => [GS, 0x21, n];
/** `ESC a n` — 0 left, 1 centre, 2 right. */
const align = (n: 0 | 1 | 2): number[] => [ESC, 0x61, n];
/** `ESC E n` — bold on/off. */
const bold = (on: boolean): number[] => [ESC, 0x45, on ? 1 : 0];
/** `ESC d n` — print and feed n lines. */
const feed = (n: number): number[] => [ESC, 0x64, n];
/** `GS V 66 n` — partial cut, feeding n lines first. */
const CUT = [GS, 0x56, 0x42, 0x03];

/* -------------------------------------------------------------------------- */
/* Text normalisation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Reduce any string to the printable ASCII range.
 *
 * Thermal printers default to a single-byte code page (PC437 on most units), so
 * typographic quotes, dashes, accents and the cedi sign would otherwise print as
 * garbage or be dropped mid-word. Accents are folded to their base letter first
 * so Ghanaian and European names stay readable.
 */
export function toAscii(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    // Strip combining accents left over from NFD decomposition (U+0300–U+036F).
    .replace(/[̀-ͯ]/g, '')
    // Curly quotes → straight quotes.
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    // Dashes / minus → hyphen, ellipsis → three dots.
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    // ₵ is written straight after "GH", so mapping it to "S" yields "GHS".
    .replace(/₵/g, 'S')
    // £ / € have no reliable single-byte slot — drop them and keep the digits.
    .replace(/[£€]/g, '')
    // Drop anything still outside printable ASCII (emoji, box drawing, etc).
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split text into chunks no longer than `width`, breaking on spaces. */
export function wrapText(text: string, width: number): string[] {
  const clean = toAscii(text);
  if (width <= 0) return clean ? [clean] : [];
  if (clean.length <= width) return clean ? [clean] : [];

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    // Hard-break words longer than a full line (long SKUs, URLs).
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }

    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

const padEnd = (s: string, width: number): string =>
  s.length >= width ? s : s + ' '.repeat(width - s.length);

const padStart = (s: string, width: number): string =>
  s.length >= width ? s : ' '.repeat(width - s.length) + s;

/* -------------------------------------------------------------------------- */
/* Amount formatting                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Printer-safe amount. Uses "GHS" rather than the cedi sign because that glyph
 * has no slot in PC437 and would print as noise.
 */
export function formatAmount(amount: number | null | undefined): string {
  const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value).toFixed(2);
  const [whole, decimal] = abs.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}GHS ${grouped}.${decimal}`;
}

/* -------------------------------------------------------------------------- */
/* Line assembly                                                                */
/* -------------------------------------------------------------------------- */

type Emit = (bytes: number[]) => void;

const toCode = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

function emitTextLine(
  emit: Emit,
  text: string,
  columns: number,
  opts: { center?: boolean; bold?: boolean; double?: boolean } = {},
): void {
  emit(align(opts.center ? 1 : 0));
  emit(bold(Boolean(opts.bold)));
  emit(charSize(opts.double ? 0x11 : 0x00));

  // A double-size glyph occupies two columns, so the visible line is half as long.
  const effective = opts.double ? Math.max(1, Math.floor(columns / 2)) : columns;
  const content = toAscii(text);
  const padded = opts.center ? center(content, effective) : padEnd(content, effective);
  emit(toCode(padded));
  emit([0x0a]);
}

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const slack = width - text.length;
  const left = Math.floor(slack / 2);
  return ' '.repeat(left) + text + ' '.repeat(slack - left);
}

/** `label` left, `value` right, on a single ruled line. */
function kvLine(emit: Emit, label: string, value: string, columns: number): void {
  const l = toAscii(label);
  const v = toAscii(value);
  const gap = columns - l.length - v.length;
  const line = gap >= 1 ? `${l}${' '.repeat(gap)}${v}` : `${l} ${v}`.slice(0, columns);
  emit(toCode(line));
  emit([0x0a]);
}

function rule(emit: Emit, columns: number, char = '-'): void {
  emit(toCode(char.repeat(columns)));
  emit([0x0a]);
}

function textLine(emit: Emit, text: string, columns: number, boldLine = false): void {
  emit(align(0));
  emit(bold(boldLine));
  emit(toCode(padEnd(toAscii(text), columns)));
  emit([0x0a]);
  if (boldLine) emit(bold(false));
}

/* -------------------------------------------------------------------------- */
/* Receipt builder                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Render a sale as an ESC/POS byte stream.
 *
 * Mirrors the on-screen receipt layout in `ReceiptModal` — same fields, same
 * order — so what the cashier previews is what lands on the paper.
 */
export function buildReceiptBytes(
  sale: Sale,
  tenant: Tenant,
  paperWidth: PaperWidth = 80,
): Uint8Array {
  const columns = COLUMNS[paperWidth];
  const out: number[] = [];
  const emit: Emit = (bytes) => {
    for (const b of bytes) out.push(b);
  };

  emit(CMD_INIT);
  emit(CMD_CODEPAGE);

  /* --- Store header ------------------------------------------------------ */
  emit(align(1));
  emitTextLine(emit, tenant.name, columns, { center: true, bold: true, double: true });

  for (const detail of [tenant.address, tenant.phone ? `Tel: ${tenant.phone}` : '']) {
    if (!detail) continue;
    for (const line of wrapText(detail, columns)) {
      emitTextLine(emit, line, columns, { center: true });
    }
  }

  emitTextLine(emit, 'SUPERMARKET TAX INVOICE', columns, { center: true, bold: true });
  rule(emit, columns);

  /* --- Invoice meta ------------------------------------------------------ */
  kvLine(emit, 'Invoice:', sale.invoice_number, columns);
  kvLine(emit, 'Date:', formatDate(sale.created_at), columns);
  kvLine(emit, 'Cashier:', sale.cashier_name, columns);
  if (sale.customer_name) {
    kvLine(emit, 'Customer:', sale.customer_name, columns);
  }
  rule(emit, columns);

  /* --- Line items -------------------------------------------------------- */
  textLine(emit, 'ITEM', columns, true);

  for (const item of sale.items ?? []) {
    const name = toAscii(item.product_name);
    const qtyPrice = `${item.quantity} x ${Number(item.unit_price ?? 0).toFixed(2)}`;
    const total = Number(item.total_amount ?? 0).toFixed(2);

    // Prefer a single line when the whole row fits the roll.
    const fitsSingle =
      name.length + qtyPrice.length + total.length + 3 <= columns;

    if (fitsSingle) {
      const gap = columns - name.length - total.length;
      emit(toCode(`${name}${' '.repeat(gap)}${total}`));
      emit([0x0a]);
      emit(toCode(padStart(qtyPrice, columns)));
      emit([0x0a]);
    } else {
      for (const line of wrapText(name, columns)) {
        emit(toCode(line));
        emit([0x0a]);
      }
      const gap = Math.max(1, columns - qtyPrice.length - total.length);
      emit(toCode(`${qtyPrice}${' '.repeat(gap)}${total}`.slice(0, columns)));
      emit([0x0a]);
    }
  }

  rule(emit, columns);

  /* --- Totals ------------------------------------------------------------ */
  kvLine(emit, 'Subtotal:', formatAmount(sale.subtotal), columns);
  if (Number(sale.discount_amount) > 0) {
    kvLine(emit, 'Discount:', `-${formatAmount(sale.discount_amount)}`, columns);
  }
  if (Number(sale.tax_amount) > 0) {
    kvLine(emit, 'Tax:', formatAmount(sale.tax_amount), columns);
  }

  // TOTAL gets the double-size treatment so it stands out on the slip.
  emit(bold(true));
  kvLine(emit, 'TOTAL:', formatAmount(sale.total_amount), columns);
  emit(bold(false));
  rule(emit, columns);

  /* --- Payment ----------------------------------------------------------- */
  kvLine(
    emit,
    'Payment:',
    toAscii(sale.payment_method.replace('_', ' ')).toUpperCase(),
    columns,
  );

  const details = sale.payment_details;
  if (details?.cash_tendered !== undefined) {
    kvLine(emit, 'Cash Tendered:', formatAmount(details.cash_tendered), columns);
    kvLine(emit, 'Change Due:', formatAmount(details.change_due ?? 0), columns);
  }
  if (details?.momo_network) kvLine(emit, 'MoMo Network:', details.momo_network, columns);
  if (details?.momo_number) kvLine(emit, 'MoMo Number:', details.momo_number, columns);
  if (details?.momo_reference) kvLine(emit, 'MoMo Ref:', details.momo_reference, columns);
  if (details?.card_reference) kvLine(emit, 'Card Ref:', details.card_reference, columns);

  /* --- Footer ------------------------------------------------------------ */
  rule(emit, columns);
  for (const text of [
    'Thank you for shopping with us!',
    'Goods sold are returnable within 48h with receipt.',
    'Powered by Samtech Helper POS',
  ]) {
    for (const line of wrapText(text, columns)) {
      emitTextLine(emit, line, columns, { center: true });
    }
  }

  emit(feed(4));
  emit(CUT);

  return Uint8Array.from(out);
}

/** Human-friendly date that fits a narrow column: `24 Oct 2026, 10:30 am`. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return toAscii(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString('en-GB', { month: 'short' });
  const year = date.getFullYear();
  const time = date
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase();
  return `${day} ${month} ${year}, ${time}`;
}

/** Browser/Node-safe base64 encoding for transport over HTTP. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (typeof btoa === 'function') return btoa(binary);
  // Node fallback for older runtimes without a global btoa.
  const buffer = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(e: string): string } } })
    .Buffer;
  if (buffer) return buffer.from(bytes).toString('base64');
  throw new Error('No base64 encoder available in this runtime');
}
