/**
 * Generate `build-resources/app.ico` from the approved app logo
 * (`public/app-logo.png`) — no external image tooling required.
 *
 * The ICO contains real 16/32/48 px BMP entries (max compatibility with
 * Explorer, taskbar and the NSIS installer) plus a 256 px PNG entry, all
 * resized from the source with an area-average filter.
 *
 * Run via `pnpm desktop:assets` (the desktop:dist pipeline runs it too).
 * The source PNG is never modified.
 */
import {deflateSync, inflateSync} from 'node:zlib';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

interface RgbaImage {
  data: Uint8Array; // RGBA8, row-major
  width: number;
  height: number;
}

/* -------------------------------------------------------------------------- */
/* PNG decoding                                                                */
/* -------------------------------------------------------------------------- */

let crcTable: Uint32Array | null = null;

function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw: Uint8Array, stride: number, height: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    switch (filter) {
      case 0:
        row.set(line);
        break;
      case 1:
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? row[i - bpp] : 0;
          row[i] = (line[i] + left) & 0xff;
        }
        break;
      case 2:
        for (let i = 0; i < stride; i++) row[i] = (line[i] + prev[i]) & 0xff;
        break;
      case 3:
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? row[i - bpp] : 0;
          row[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? row[i - bpp] : 0;
          const b = prev[i];
          const c = i >= bpp ? prev[i - bpp] : 0;
          row[i] = (line[i] + paeth(a, b, c)) & 0xff;
        }
        break;
      default:
        throw new Error(`Unsupported PNG filter type ${filter}`);
    }
  }
  return out;
}

function decodePng(buf: Buffer): RgbaImage {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) {
    if (buf[i] !== signature[i]) throw new Error('Source is not a PNG file.');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Buffer[] = [];
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatParts.push(Buffer.from(data));
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!width || !height) throw new Error('PNG has no IHDR.');
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth} (only 8 supported).`);
  if (interlace !== 0) throw new Error('Interlaced PNGs are not supported.');

  const channelsByType: Record<number, number> = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4};
  const bpp = channelsByType[colorType];
  if (!bpp) throw new Error(`Unsupported PNG color type ${colorType}.`);
  if (colorType === 3 && !palette) throw new Error('Indexed PNG is missing its palette.');

  const inflated = inflateSync(Buffer.concat(idatParts));
  const stride = width * bpp;
  const filtered = unfilter(new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.length), stride, height, bpp);

  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * bpp;
    const d = i * 4;
    switch (colorType) {
      case 6:
        out[d] = filtered[s];
        out[d + 1] = filtered[s + 1];
        out[d + 2] = filtered[s + 2];
        out[d + 3] = filtered[s + 3];
        break;
      case 2:
        out[d] = filtered[s];
        out[d + 1] = filtered[s + 1];
        out[d + 2] = filtered[s + 2];
        out[d + 3] = 255;
        break;
      case 0:
        out[d] = out[d + 1] = out[d + 2] = filtered[s];
        out[d + 3] = 255;
        break;
      case 4:
        out[d] = out[d + 1] = out[d + 2] = filtered[s];
        out[d + 3] = filtered[s + 1];
        break;
      case 3: {
        const idx = filtered[s];
        out[d] = palette![idx * 3];
        out[d + 1] = palette![idx * 3 + 1];
        out[d + 2] = palette![idx * 3 + 2];
        out[d + 3] = transparency && idx < transparency.length ? transparency[idx] : 255;
        break;
      }
    }
  }

  return {data: out, width, height};
}

/* -------------------------------------------------------------------------- */
/* Resizing                                                                    */
/* -------------------------------------------------------------------------- */

/** Area-average downscale (decent quality for large logo → small icon sizes). */
function resize(src: RgbaImage, size: number): RgbaImage {
  const out = new Uint8Array(size * size * 4);
  const sx = src.width / size;
  const sy = src.height / size;

  for (let oy = 0; oy < size; oy++) {
    const y0 = Math.floor(oy * sy);
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.ceil((oy + 1) * sy)));
    for (let ox = 0; ox < size; ox++) {
      const x0 = Math.floor(ox * sx);
      const x1 = Math.min(src.width, Math.max(x0 + 1, Math.ceil((ox + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const s = (y * src.width + x) * 4;
          r += src.data[s];
          g += src.data[s + 1];
          b += src.data[s + 2];
          a += src.data[s + 3];
          n++;
        }
      }
      const d = (oy * size + ox) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      out[d + 3] = Math.round(a / n);
    }
  }

  return {data: out, width: size, height: size};
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                    */
/* -------------------------------------------------------------------------- */

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(img: RgbaImage): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, {level: 9})),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Classic uncompressed 32-bit BGRA bitmap entry + zeroed AND mask. */
function encodeBmpEntry(img: RgbaImage): Buffer {
  const size = img.width;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // BITMAPINFOHEADER size
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // doubled: color + AND mask
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bit count
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(size * size * 4, 20);

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = y * size * 4;
    const dstRow = (size - 1 - y) * size * 4; // bottom-up
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      pixels[d] = img.data[s + 2]; // B
      pixels[d + 1] = img.data[s + 1]; // G
      pixels[d + 2] = img.data[s]; // R
      pixels[d + 3] = img.data[s + 3]; // A
    }
  }

  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size); // all zeros: alpha channel decides

  return Buffer.concat([header, pixels, mask]);
}

function encodeIco(entries: Array<{size: number; data: Buffer}>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directory: Buffer[] = [];
  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = entry.size >= 256 ? 0 : entry.size;
    dir[1] = entry.size >= 256 ? 0 : entry.size;
    dir[2] = 0; // palette colors
    dir[3] = 0;
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(entry.data.length, 8);
    dir.writeUInt32LE(offset, 12);
    directory.push(dir);
    offset += entry.data.length;
  }

  return Buffer.concat([header, ...directory, ...entries.map((e) => e.data)]);
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'public', 'app-logo.png');
const OUTPUT = path.join(ROOT, 'build-resources', 'app.ico');

if (!existsSync(SOURCE)) {
  console.error(`[make-ico] Source logo not found: ${SOURCE}`);
  process.exit(1);
}

const source = decodePng(readFileSync(SOURCE));
console.log(`[make-ico] ${path.relative(ROOT, SOURCE)} — ${source.width}x${source.height}`);

const sizes = [16, 32, 48, 256];
const entries = sizes.map((size) => {
  const img = resize(source, size);
  // 256 px goes in as a PNG entry (standard for large icons); the small sizes
  // use classic BMP entries for maximum compatibility.
  const data = size >= 256 ? encodePng(img) : encodeBmpEntry(img);
  return {size, data};
});

const ico = encodeIco(entries);
mkdirSync(path.dirname(OUTPUT), {recursive: true});
writeFileSync(OUTPUT, ico);
console.log(
  `[make-ico] wrote ${path.relative(ROOT, OUTPUT)} — ${entries.length} sizes (${sizes.join(', ')}), ${ico.length} bytes`,
);
