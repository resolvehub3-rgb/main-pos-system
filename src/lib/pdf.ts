/**
 * Lightweight, dependency-free PDF report writer + browser printing for the
 * Stock Book.
 *
 * Produces a real multi-page vector PDF (A4 landscape, Helvetica) with:
 * - shop / branch / period / generation-timestamp metadata block,
 * - repeated table headings on every page,
 * - right-aligned numeric columns and clear currency labels,
 * - page numbering.
 *
 * This generates a genuine report document — NOT a screenshot of the UI.
 */

export interface PdfColumn {
  header: string;
  /** Column width as a fraction of the usable table width (sums to ~1). */
  width: number;
  align?: 'left' | 'right';
}

export interface PdfReportOptions {
  title: string;
  /** Metadata lines: shop name, branch, period, generated timestamp… */
  metadata?: string[];
  columns: PdfColumn[];
  rows: string[][];
  /** Footer note (e.g. "Values at weighted-average cost") */
  footer?: string;
}

const PAGE_W = 842; // A4 landscape, points
const PAGE_H = 595;
const MARGIN = 32;
const TABLE_W = PAGE_W - MARGIN * 2;
const ROW_H = 14;
const BODY_SIZE = 8.5;
const HEADER_SIZE = 8.5;

// Helvetica AFM widths (/1000 em) for ASCII 32..126 + 0xA2 (₵)
const HELVETICA_WIDTHS: number[] = (() => {
  const w = new Array<number>(256).fill(556);
  const table: Array<[number, number]> = [
    [32, 278], [33, 278], [34, 355], [35, 556], [36, 556], [37, 889], [38, 667],
    [39, 191], [40, 333], [41, 333], [42, 389], [43, 584], [44, 278], [45, 333],
    [46, 278], [47, 278], [58, 278], [59, 278], [60, 584], [61, 584], [62, 584],
    [63, 556], [64, 1015], [65, 667], [66, 667], [67, 722], [68, 722], [69, 667],
    [70, 611], [71, 778], [72, 722], [73, 278], [74, 500], [75, 667], [76, 556],
    [77, 833], [78, 722], [79, 778], [80, 667], [81, 778], [82, 722], [83, 667],
    [84, 611], [85, 722], [86, 667], [87, 944], [88, 667], [89, 667], [90, 611],
    [91, 278], [92, 278], [93, 278], [94, 469], [95, 556], [96, 333], [97, 556],
    [98, 556], [99, 500], [100, 556], [101, 556], [102, 278], [103, 556], [104, 556],
    [105, 222], [106, 222], [107, 500], [108, 222], [109, 833], [110, 556], [111, 556],
    [112, 556], [113, 556], [114, 333], [115, 500], [116, 278], [117, 556], [118, 500],
    [119, 722], [120, 500], [121, 500], [122, 500], [123, 334], [124, 260], [125, 334],
    [126, 584], [160, 278], [162, 556], [163, 556], [165, 556], [169, 737], [174, 737],
    [176, 400], [177, 584], [183, 278], [8364, 556], [0xa2, 556],
  ];
  for (const [code, width] of table) w[code] = width;
  for (let d = 48; d <= 57; d++) w[d] = 556; // digits
  return w;
})();

/** Approximate width of `text` in points when rendered at `size`. */
export function textWidth(text: string, size: number): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    units += HELVETICA_WIDTHS[code] ?? 556;
  }
  return (units / 1000) * size;
}

/** Encode a JS string as a WinAnsi-ish PDF literal string (1 byte/char). */
function pdfEscape(text: string): string {
  let out = '';
  for (const ch of text) {
    let code = ch.charCodeAt(0);
    // The app's currency symbol is U+20B5 (Ghana cedi sign). WinAnsiEncoding
    // has no cedi glyph — map it to the visually identical cent sign (0xA2).
    if (code === 0x20b5) code = 0xa2;
    if (code > 255) code = 63; // '?'
    const c = String.fromCharCode(code);
    if (c === '(' || c === ')' || c === '\\') out += '\\' + c;
    else if (code < 32) out += ' ';
    else out += c;
  }
  return out;
}

/** Truncate text so it fits `maxWidth` points at `size` (adds '…'). */
export function fitText(text: string, size: number, maxWidth: number): string {
  if (textWidth(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && textWidth(out + '…', size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

function columnXPositions(columns: PdfColumn[]): { x: number; w: number }[] {
  const total = columns.reduce((s, c) => s + c.width, 0) || 1;
  let x = MARGIN;
  return columns.map((c) => {
    const w = (c.width / total) * TABLE_W;
    const pos = { x, w };
    x += w;
    return pos;
  });
}

function drawRow(
  cells: string[],
  columns: PdfColumn[],
  positions: { x: number; w: number }[],
  y: number,
  font: 'F1' | 'F2',
  size: number
): string {
  let ops = '';
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const pos = positions[i];
    const text = fitText(cells[i] ?? '', size, pos.w - 6);
    let tx = pos.x + 3;
    if (col.align === 'right') {
      tx = pos.x + pos.w - 3 - textWidth(text, size);
    }
    ops += `BT /${font} ${size} Tf 1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(text)}) Tj ET\n`;
  }
  return ops;
}

function hline(y: number): string {
  return `${MARGIN} ${y.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${y.toFixed(2)} l S\n`;
}

/**
 * Build a multi-page A4-landscape PDF report as raw bytes.
 * Pure function — safe to unit-test in Node.
 */
export function buildTablePdf(opts: PdfReportOptions): Uint8Array {
  const positions = columnXPositions(opts.columns);

  // ---- Page composition -------------------------------------------------
  const pages: string[] = [];
  let remaining = opts.rows.slice();
  let pageNo = 0;

  // Reserve space for title + metadata on the first page only
  const firstPageTop = (() => {
    let y = PAGE_H - MARGIN;
    y -= 18; // title
    y -= (opts.metadata?.length || 0) * 11 + 6;
    return y;
  })();
  const laterPageTop = PAGE_H - MARGIN - 16;

  // Compute rows-per-page
  const headerBlockH = ROW_H + 4;
  const firstRows = Math.max(1, Math.floor((firstPageTop - MARGIN - 20 - headerBlockH) / ROW_H));
  const laterRows = Math.max(1, Math.floor((laterPageTop - MARGIN - 20 - headerBlockH) / ROW_H));

  // estimated page count for "Page N of M"
  let estPages = 1;
  let capacity = firstRows;
  let count = remaining.length;
  while (count > 0) {
    const take = Math.min(count, capacity);
    count -= take;
    if (count > 0) {
      estPages++;
      capacity = laterRows;
    }
  }

  while (remaining.length > 0 || pageNo === 0) {
    pageNo++;
    const isFirst = pageNo === 1;
    const capacityNow = isFirst ? firstRows : laterRows;
    const chunk = remaining.slice(0, capacityNow);
    remaining = remaining.slice(capacityNow);

    let y = PAGE_H - MARGIN;

    if (isFirst) {
      // Title
      let ops = `BT /F2 14 Tf 1 0 0 1 ${MARGIN} ${y - 14} Tm (${pdfEscape(fitText(opts.title, 14, TABLE_W))}) Tj ET\n`;
      y -= 18;
      for (const line of opts.metadata || []) {
        ops += `BT /F1 8.5 Tf 0.35 0.35 0.35 rg 1 0 0 1 ${MARGIN} ${y - 9} Tm (${pdfEscape(fitText(line, 8.5, TABLE_W))}) Tj ET\n`;
        y -= 11;
      }
      y -= 4;
      // header row
      ops += drawRow(opts.columns.map((c) => c.header), opts.columns, positions, y - 11, 'F2', HEADER_SIZE);
      y -= 2;
      ops += hline(y);
      y -= ROW_H - 2;
      for (const row of chunk) {
        ops += drawRow(row, opts.columns, positions, y, 'F1', BODY_SIZE);
        y -= ROW_H;
      }
      pages.push(ops);
    } else {
      let ops = `BT /F1 8 Tf 0.4 0.4 0.4 rg 1 0 0 1 ${MARGIN} ${y - 9} Tm (${pdfEscape(fitText(opts.title, 8.5, TABLE_W - 140))}) Tj ET\n`;
      y -= 16;
      ops += drawRow(opts.columns.map((c) => c.header), opts.columns, positions, y - 11, 'F2', HEADER_SIZE);
      y -= 2;
      ops += hline(y);
      y -= ROW_H - 2;
      for (const row of chunk) {
        ops += drawRow(row, opts.columns, positions, y, 'F1', BODY_SIZE);
        y -= ROW_H;
      }
      pages.push(ops);
    }
  }

  // Footer on every page: report note + page numbers
  for (let i = 0; i < pages.length; i++) {
    let footer = `0.4 0.4 0.4 rg\n`;
    if (opts.footer) {
      footer += `BT /F1 7.5 Tf 0.45 0.45 0.45 rg 1 0 0 1 ${MARGIN} ${MARGIN - 6} Tm (${pdfEscape(fitText(opts.footer, 7.5, TABLE_W - 150))}) Tj ET\n`;
    }
    const pageLabel = `Page ${i + 1} of ${pages.length}`;
    footer += `BT /F1 7.5 Tf 0.45 0.45 0.45 rg 1 0 0 1 ${(PAGE_W - MARGIN - textWidth(pageLabel, 7.5)).toFixed(2)} ${MARGIN - 6} Tm (${pdfEscape(pageLabel)}) Tj ET\n`;
    pages[i] += footer;
  }

  // ---- Assemble PDF objects ---------------------------------------------
  const objects: string[] = [];
  const addObject = (body: string): number => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  const fontObj = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const boldFontObj = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  for (const content of pages) {
    contentObjNums.push(addObject(`<< /Length ${byteLength(content)} >>\nstream\n${content}endstream`));
    pageObjNums.push(0); // placeholder, filled after we know numbers
  }
  // Pages object references page objects; page numbers were assigned in order:
  // content objects interleaved before page objects — assign page objects now.
  for (let i = 0; i < pages.length; i++) {
    pageObjNums[i] = addObject(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${fontObj} 0 R /F2 ${boldFontObj} 0 R >> >> ` +
        `/Contents ${contentObjNums[i]} 0 R >>`
    );
  }
  const pagesObj = addObject(
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`
  );
  // Fix /Parent references inside page objects
  for (const num of pageObjNums) {
    objects[num - 1] = objects[num - 1].replace('/Parent 0 0 R', `/Parent ${pagesObj} 0 R`);
  }
  const catalogObj = addObject(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  // ---- Serialize with xref ----------------------------------------------
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(byteLength(out));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return latin1ToBytes(out);
}

function byteLength(binaryString: string): number {
  let len = 0;
  for (const ch of binaryString) {
    len++;
    if (ch.charCodeAt(0) > 255) len++; // non-latin1 chars (should not occur)
  }
  return len; // byte == char for latin1
}

function latin1ToBytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    bytes[i] = code > 255 ? 63 : code;
  }
  return bytes;
}

/** Trigger a browser download of the PDF bytes. */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------------------
// Browser printing (styled HTML print view with repeated table headings)
// ---------------------------------------------------------------------------

function htmlEscape(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render the report as a standalone printable HTML document. */
export function buildPrintHtml(opts: PdfReportOptions): string {
  const head = (opts.metadata || [])
    .map((m) => `<div class="meta">${htmlEscape(m)}</div>`)
    .join('');
  const columns = opts.columns
    .map(
      (c) =>
        `<th class="${c.align === 'right' ? 'num' : ''}">${htmlEscape(c.header)}</th>`
    )
    .join('');
  const body = opts.rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, i) =>
              `<td class="${opts.columns[i]?.align === 'right' ? 'num' : ''}">${htmlEscape(cell)}</td>`
          )
          .join('')}</tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${htmlEscape(opts.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Montserrat', Arial, sans-serif; color: #0f172a; margin: 0; padding: 16px; }
  h1 { font-size: 16px; font-weight: 800; margin: 0 0 6px; }
  .meta { font-size: 10px; color: #475569; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10px; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  th { text-align: left; background: #102A4C; color: #fff; padding: 6px 8px; font-weight: 700; }
  td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr { page-break-inside: avoid; }
  .footer { margin-top: 12px; font-size: 9px; color: #64748b; }
  @media print { body { padding: 0; } .no-print { display: none !important; } }
</style>
</head>
<body>
  <h1>${htmlEscape(opts.title)}</h1>
  ${head}
  <table>
    <thead><tr>${columns}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  ${opts.footer ? `<div class="footer">${htmlEscape(opts.footer)}</div>` : ''}
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };</script>
</body>
</html>`;
}

/**
 * Open the report in a dedicated window and invoke the browser print dialog
 * (user can print or "Save as PDF").
 */
export function printReport(opts: PdfReportOptions): void {
  const win = window.open('', '_blank', 'width=1200,height=800');
  if (!win) {
    alert('Please allow pop-ups for this site to print reports.');
    return;
  }
  win.document.open();
  win.document.write(buildPrintHtml(opts));
  win.document.close();
}
