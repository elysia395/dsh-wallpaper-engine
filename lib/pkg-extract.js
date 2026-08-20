/**
 * dsh-wallpaper-engine — scene.pkg / scene.json static-frame extractor.
 *
 * Extracts the MAIN texture of a Wallpaper Engine scene wallpaper as a
 * standalone static image the browser can show behind the GUI:
 *
 *   - Packed scenes (`scene.pkg`, magic PKGVxxxx): the PKG entry index is
 *     parsed, entries are decompressed (LZ4 block chains, the format WE uses
 *     inside PKG containers), then the TEX container of each candidate
 *     texture is decoded.
 *   - Loose scenes (`scene.json` + plain .tex/.json files, e.g. WE
 *     defaultprojects): the same pipeline runs over a path-fenced directory
 *     access layer.
 *   - TEX containers (magic TEXV0005/TEXI0001) are parsed for metadata,
 *     mipmaps (TEXB0001..4, LZ4 or raw) and animated GIF frame tables
 *     (TEXS0001..3). The first mipmap of the first image is decoded to
 *     RGBA8888 for RGBA8888 / R8 / RG88 / DXT1 / DXT3 / DXT5.
 *   - **Embedded JPEG textures**: Wallpaper Engine stores photographic
 *     textures as a complete JPEG payload inside the TEX container (the mip
 *     data starts with FFD8 JFIF). Those are returned as-is — zero decoding,
 *     the most faithful and cheapest path for photographic scene wallpapers
 *     (the skin-center's extractor misses this variant and silently falls
 *     back to a mask texture; this module fixes that).
 *
 * Candidate selection: the first scene.json object carrying an `image`
 * property wins (its direct .tex reference, or the textures listed by the
 * material / instance it points at), then remaining .tex files are ranked by
 * pixel area with `mask`/`normal` paths penalized (they are grayscale /
 * normal-map helpers, never the wallpaper art). The first candidate that
 * decodes cleanly is returned.
 *
 * Zero runtime dependencies (node:zlib only). Format knowledge mirrors the
 * public RePKG / lwe reverse-engineering of the Wallpaper Engine formats.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

/** Wallpaper Engine texture format ids (TEXI0001 header), per RePKG/lwe. */
const TexFormat = {
  RGBA8888: 0,
  RGB888: 1,
  RGB565: 2,
  DXT5: 4,
  DXT3: 6,
  DXT1: 7,
  RG88: 8,
  R8: 9,
  RG1616F: 10,
  R16F: 11,
  BC7: 12,
  RGBA1010102: 13,
  RGBA16161616F: 14,
  RGB161616F: 15,
};
const TEX_FORMAT_NAMES = {
  0: 'RGBA8888',
  1: 'RGB888',
  2: 'RGB565',
  4: 'DXT5',
  6: 'DXT3',
  7: 'DXT1',
  8: 'RG88',
  9: 'R8',
  10: 'RG1616F',
  11: 'R16F',
  12: 'BC7',
  13: 'RGBA1010102',
  14: 'RGBA16161616F',
  15: 'RGB161616F',
};
/** TEXI0001 flags bit marking an animated (sprite-sheet / gif) texture. */
const TEX_FLAG_IS_GIF = 4;

const textDecoder = new TextDecoder('utf-8');

/**
 * Bounds-checked little-endian binary reader. Every failed read throws an
 * Error prefixed with the reader label.
 */
class Reader {
  constructor(data, label) {
    this.data = data;
    this.label = label;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = 0;
  }
  get remaining() {
    return this.view.byteLength - this.pos;
  }
  need(n) {
    if (n < 0 || this.pos + n > this.view.byteLength) {
      throw new Error(this.label + ': unexpected end of data');
    }
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** Unsigned 64-bit integer; safe up to 2^53. */
  u64() {
    const lo = this.u32();
    return this.u32() * 4294967296 + lo;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  bytes(n) {
    this.need(n);
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** int32-length-prefixed UTF-8 string (PKG magic and entry paths). */
  sizedString(maxLength) {
    const length = this.i32();
    if (length < 0 || length > maxLength) {
      throw new Error(this.label + ': invalid string length ' + length);
    }
    return textDecoder.decode(this.bytes(length));
  }
  /** NUL-terminated string (all TEX magics and the TEXB0004 json blob). */
  nstring(maxLength) {
    const start = this.pos;
    let end = start;
    const limit = Math.min(this.view.byteLength, start + maxLength);
    while (end < limit && this.view.getUint8(end) !== 0) end++;
    if (end >= limit) throw new Error(this.label + ': unterminated string');
    const out = textDecoder.decode(this.data.subarray(start, end));
    this.pos = end + 1;
    return out;
  }
}

/**
 * Decompress one raw LZ4 block (the format inside PKG entry chains and TEXB
 * mipmaps) following the official lz4 block format specification.
 *
 * @param src compressed block bytes
 * @param dstSize exact expected decompressed size
 */
function lz4DecompressBlock(src, dstSize) {
  const dst = new Uint8Array(dstSize);
  let ip = 0;
  let op = 0;
  while (ip < src.length) {
    const token = src[ip++];
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let s = 0;
      do {
        if (ip >= src.length) throw new Error('lz4: truncated literal length');
        s = src[ip++];
        literalLength += s;
      } while (s === 255);
    }
    if (ip + literalLength > src.length || op + literalLength > dstSize) {
      throw new Error('lz4: literal run out of bounds');
    }
    dst.set(src.subarray(ip, ip + literalLength), op);
    ip += literalLength;
    op += literalLength;
    if (ip >= src.length) break;
    if (ip + 2 > src.length) throw new Error('lz4: truncated match offset');
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw new Error('lz4: invalid match offset ' + offset);
    let matchLength = token & 15;
    if (matchLength === 15) {
      let s = 0;
      do {
        if (ip >= src.length) throw new Error('lz4: truncated match length');
        s = src[ip++];
        matchLength += s;
      } while (s === 255);
    }
    matchLength += 4;
    if (op + matchLength > dstSize) throw new Error('lz4: match run out of bounds');
    for (let i = 0; i < matchLength; i++) {
      dst[op] = dst[op - offset];
      op++;
    }
  }
  if (op !== dstSize) {
    throw new Error('lz4: decompressed size mismatch (got ' + op + ', expected ' + dstSize + ')');
  }
  return dst;
}

/**
 * Probe whether the entry data at [abs, abs+length) is an LZ4 block chain:
 * int64 original size followed by [int32 uncomp][int32 comp][block] entries
 * that reconstruct exactly originalSize bytes while consuming the entry to
 * the byte. Returns the original size when the chain fits perfectly.
 */
function probeCompressedEntry(data, abs, length) {
  if (length < 8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const originalSize = view.getUint32(abs, true) + view.getUint32(abs + 4, true) * 4294967296;
  if (originalSize <= length || originalSize > 2147483647) return null;
  let pos = abs + 8;
  let total = 0;
  while (total < originalSize) {
    if (pos + 8 > abs + length) return null;
    const uncomp = view.getInt32(pos, true);
    const comp = view.getInt32(pos + 4, true);
    if (uncomp <= 0 || comp <= 0 || pos + 8 + comp > abs + length) return null;
    total += uncomp;
    pos += 8 + comp;
  }
  return total === originalSize && pos === abs + length ? originalSize : null;
}

/**
 * Parse a PKG container (magic PKGVxxxx) and return its entry index.
 * Entry offsets in the returned list are absolute positions inside data.
 */
function parsePkg(data) {
  const r = new Reader(data, 'pkg');
  const magic = r.sizedString(32);
  if (!/^PKGV\d{4}$/.test(magic)) throw new Error("pkg: bad magic '" + magic + "'");
  const count = r.i32();
  if (count < 0 || count > 1048576) throw new Error('pkg: invalid entry count ' + count);
  const index = [];
  for (let i = 0; i < count; i++) {
    index.push({ path: r.sizedString(1024), offset: r.u32(), length: r.u32() });
  }
  const dataStart = r.pos;
  return index.map(({ path, offset, length }) => {
    const abs = dataStart + offset;
    if (abs + length > data.byteLength) throw new Error("pkg: entry '" + path + "' out of bounds");
    const originalSize = probeCompressedEntry(data, abs, length);
    return originalSize === null
      ? { path, offset: abs, compressedSize: length, size: length, flags: 0 }
      : { path, offset: abs, compressedSize: length, size: originalSize, flags: 1 };
  });
}

/**
 * Extract (and decompress, when the entry uses LZ4 block-chain storage) one
 * package entry. Returns a fresh buffer of exactly entry.size bytes.
 */
function readPkgEntry(data, entry) {
  const abs = entry.offset;
  if (abs < 0 || abs + entry.compressedSize > data.byteLength) {
    throw new Error("pkg: entry '" + entry.path + "' out of bounds");
  }
  if ((entry.flags & 1) === 0) return data.slice(abs, abs + entry.compressedSize);
  const r = new Reader(data.subarray(abs, abs + entry.compressedSize), 'pkg');
  if (r.u64() !== entry.size) throw new Error("pkg: entry '" + entry.path + "' size mismatch");
  const out = new Uint8Array(entry.size);
  let written = 0;
  while (written < entry.size) {
    const uncomp = r.i32();
    const comp = r.i32();
    if (uncomp <= 0 || comp <= 0 || written + uncomp > entry.size) {
      throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
    }
    out.set(lz4DecompressBlock(r.bytes(comp), uncomp), written);
    written += uncomp;
  }
  if (r.remaining !== 0) throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
  return out;
}

/** Read one mipmap record; containerVersion selects the TEXB layout. */
function readMipmap(r, containerVersion) {
  if (containerVersion === 4) {
    const param1 = r.i32();
    const param2 = r.i32();
    r.nstring(1 << 20);
    const param3 = r.i32();
    if (param1 !== 1 || param2 !== 2 || param3 !== 1) {
      throw new Error('tex: bad TEXB0004 mipmap params');
    }
  }
  const width = r.i32();
  const height = r.i32();
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
    throw new Error('tex: invalid mipmap dimensions ' + width + 'x' + height);
  }
  if (containerVersion === 1) {
    return { width, height, bytes: r.bytes(r.i32()) };
  }
  const isLz4 = r.i32() === 1;
  const decompressedCount = r.i32();
  const stored = r.bytes(r.i32());
  if (isLz4) {
    return { width, height, bytes: lz4DecompressBlock(stored, decompressedCount) };
  }
  return { width, height, bytes: stored };
}

/** Parse a TEX container into metadata plus the first image's mipmaps. */
function parseTexInternal(data) {
  const r = new Reader(data, 'tex');
  const magic1 = r.nstring(16);
  if (magic1 !== 'TEXV0005') throw new Error("tex: bad magic '" + magic1 + "'");
  const magic2 = r.nstring(16);
  if (magic2 !== 'TEXI0001') throw new Error("tex: bad image-info magic '" + magic2 + "'");
  const format = r.i32();
  const flags = r.i32();
  const textureWidth = r.i32();
  const textureHeight = r.i32();
  const imageWidth = r.i32();
  const imageHeight = r.i32();
  r.u32();
  if (TEX_FORMAT_NAMES[format] === undefined) throw new Error('tex: unsupported format ' + format);
  const containerMagic = r.nstring(16);
  const containerMatch = /^TEXB000([1-4])$/.exec(containerMagic);
  if (!containerMatch) throw new Error("tex: bad mipmap container magic '" + containerMagic + "'");
  let containerVersion = Number(containerMatch[1]);
  const imageCount = r.i32();
  if (imageCount <= 0 || imageCount > 256) throw new Error('tex: invalid image count ' + imageCount);
  let isVideoMp4 = false;
  if (containerVersion === 3) r.i32();
  else if (containerVersion === 4) {
    const freeImageFormat = r.i32();
    isVideoMp4 = r.i32() === 1;
    if (!(freeImageFormat === -1 && isVideoMp4)) containerVersion = 3;
  }
  let firstImage = null;
  for (let i = 0; i < imageCount; i++) {
    const mipmapCount = r.i32();
    if (mipmapCount <= 0 || mipmapCount > 32) throw new Error('tex: invalid mipmap count ' + mipmapCount);
    const mipmaps = [];
    for (let j = 0; j < mipmapCount; j++) mipmaps.push(readMipmap(r, containerVersion));
    if (firstImage === null) firstImage = mipmaps;
  }
  const isAnimatedGif = (flags & TEX_FLAG_IS_GIF) !== 0;
  const frames = [];
  if (isAnimatedGif) {
    const frameMagic = r.nstring(16);
    const frameMatch = /^TEXS000([1-3])$/.exec(frameMagic);
    if (!frameMatch) throw new Error("tex: bad frame container magic '" + frameMagic + "'");
    const frameVersion = Number(frameMatch[1]);
    const frameCount = r.i32();
    if (frameCount < 0 || frameCount > 4096) throw new Error('tex: invalid frame count ' + frameCount);
    if (frameVersion === 3) {
      r.i32();
      r.i32();
    }
    for (let i = 0; i < frameCount; i++) {
      const imageId = r.i32();
      const frametime = r.f32();
      if (frameVersion === 1) {
        const x = r.i32();
        const y = r.i32();
        const width = r.i32();
        r.i32();
        r.i32();
        const height = r.i32();
        frames.push({ imageId, frametime, x, y, width, height });
      } else {
        const x = r.f32();
        const y = r.f32();
        const width = r.f32();
        r.f32();
        r.f32();
        const height = r.f32();
        frames.push({ imageId, frametime, x, y, width, height });
      }
    }
  }
  const mip0 = firstImage[0];
  const embedded =
    mip0.bytes.length >= 2 && mip0.bytes[0] === 0xff && mip0.bytes[1] === 0xd8
      ? 'jpeg'
      : mip0.bytes.length >= 8 && mip0.bytes[0] === 0x89 && mip0.bytes[1] === 0x50 && mip0.bytes[2] === 0x4e && mip0.bytes[3] === 0x47
        ? 'png'
        : null;
  return {
    format,
    flags,
    width: imageWidth > 0 ? imageWidth : textureWidth > 0 ? textureWidth : mip0.width,
    height: imageHeight > 0 ? imageHeight : textureHeight > 0 ? textureHeight : mip0.height,
    isAnimatedGif,
    isVideoMp4,
    frames,
    mipmaps: firstImage,
    embedded,
  };
}

/** Parse a TEX container and return its metadata (never throws on payload). */
function parseTex(data) {
  const parsed = parseTexInternal(data);
  const info = {
    width: parsed.width,
    height: parsed.height,
    format: parsed.format,
    formatName: TEX_FORMAT_NAMES[parsed.format] ?? 'unknown(' + parsed.format + ')',
    isAnimatedGif: parsed.isAnimatedGif,
    isVideoMp4: parsed.isVideoMp4,
    mipLevels: parsed.mipmaps.length,
    embedded: parsed.embedded,
  };
  if (parsed.isAnimatedGif) info.frames = parsed.frames;
  return info;
}

// ── Embedded JPEG support ───────────────────────────────────────────────────
// Wallpaper Engine stores photographic textures as a complete JPEG payload
// inside the TEX mip data (the JPEG starts right where raw pixels would).
// Detect by the FFD8 SOI marker and hand back the bytes untouched.

/**
 * Scan JPEG markers for the first SOF segment and return { width, height }.
 * Returns null when the payload is not a parseable JPEG.
 */
function jpegSofDims(bytes) {
  const len = bytes.length;
  let p = 2;
  while (p + 9 < len) {
    if (bytes[p] !== 0xff) { p++; continue; }
    const marker = bytes[p + 1];
    if (marker === 0xd8) { p += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before SOF
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (p + 9 > len) return null;
      return {
        height: ((bytes[p + 5] << 8) | bytes[p + 6]) & 0xffff,
        width: ((bytes[p + 7] << 8) | bytes[p + 8]) & 0xffff,
      };
    }
    const segLen = ((bytes[p + 2] << 8) | bytes[p + 3]) & 0xffff;
    if (segLen < 2) return null;
    p += 2 + segLen;
  }
  return null;
}

function rgb565(value) {
  const r = (value >> 11) & 31;
  const g = (value >> 5) & 63;
  const b = value & 31;
  return [r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2];
}

/** Build the 4-color BC palette; three-color + transparent when DXT1 c0 <= c1. */
function buildColorPalette(c0, c1, fourColor) {
  const palette = new Uint8Array(16);
  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);
  palette.set([r0, g0, b0, 255], 0);
  palette.set([r1, g1, b1, 255], 4);
  if (fourColor) {
    palette.set([((2 * r0 + r1) / 3) | 0, ((2 * g0 + g1) / 3) | 0, ((2 * b0 + b1) / 3) | 0, 255], 8);
    palette.set([((r0 + 2 * r1) / 3) | 0, ((g0 + 2 * g1) / 3) | 0, ((b0 + 2 * b1) / 3) | 0, 255], 12);
  } else {
    palette.set([((r0 + r1) / 2) | 0, ((g0 + g1) / 2) | 0, ((b0 + b1) / 2) | 0, 255], 8);
    palette.set([0, 0, 0, 0], 12);
  }
  return palette;
}

/** Shared BC1/BC2/BC3 block walker (blockStride 8 for BC1, 16 for BC2/BC3). */
function decodeColorBlocks(src, out, width, height, blockStride, colorOffset, dxt1Alpha) {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * blockStride;
      const c0 = view.getUint16(base + colorOffset, true);
      const c1 = view.getUint16(base + colorOffset + 2, true);
      const palette = buildColorPalette(c0, c1, dxt1Alpha ? c0 > c1 : true);
      const indices = view.getUint32(base + colorOffset + 4, true);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const selector = (indices >> (2 * (py * 4 + px))) & 3;
          const dst = (y * width + x) * 4;
          out[dst] = palette[selector * 4];
          out[dst + 1] = palette[selector * 4 + 1];
          out[dst + 2] = palette[selector * 4 + 2];
          out[dst + 3] = palette[selector * 4 + 3];
        }
      }
    }
  }
}

/** BC1 (DXT1): 8-byte blocks, 4x4 pixels, optional 1-bit alpha. */
function decodeDxt1(src, width, height) {
  const out = new Uint8Array(width * height * 4);
  decodeColorBlocks(src, out, width, height, 8, 0, true);
  return out;
}

/** BC2 (DXT3): 16-byte blocks, 4-bit explicit alpha + BC1-style color. */
function decodeDxt3(src, width, height) {
  const out = new Uint8Array(width * height * 4);
  decodeColorBlocks(src, out, width, height, 16, 8, false);
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * 16;
      const alphaLo = view.getUint32(base, true);
      const alphaHi = view.getUint32(base + 4, true);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4);
        const y = by * 4 + ((i / 4) | 0);
        if (x >= width || y >= height) continue;
        const nibble = i < 8 ? (alphaLo >> (4 * i)) & 15 : (alphaHi >> (4 * (i - 8))) & 15;
        out[(y * width + x) * 4 + 3] = nibble * 17;
      }
    }
  }
  return out;
}

/** BC3 (DXT5): 16-byte blocks, interpolated 3-bit alpha + BC1-style color. */
function decodeDxt5(src, width, height) {
  const out = new Uint8Array(width * height * 4);
  decodeColorBlocks(src, out, width, height, 16, 8, false);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * 16;
      const a0 = src[base];
      const a1 = src[base + 1];
      const alphas = new Uint8Array(8);
      alphas[0] = a0;
      alphas[1] = a1;
      if (a0 > a1) {
        for (let k = 2; k < 8; k++) alphas[k] = (((8 - k) * a0 + (k - 1) * a1) / 7) | 0;
      } else {
        for (let k = 2; k < 6; k++) alphas[k] = (((6 - k) * a0 + (k - 2) * a1) / 5) | 0;
        alphas[6] = 0;
        alphas[7] = 255;
      }
      let bits =
        src[base + 2] +
        src[base + 3] * 256 +
        src[base + 4] * 65536 +
        src[base + 5] * 16777216 +
        src[base + 6] * 4294967296 +
        src[base + 7] * 1099511627776;
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4);
        const y = by * 4 + ((i / 4) | 0);
        const index = bits % 8;
        bits = Math.floor(bits / 8);
        if (x >= width || y >= height) continue;
        out[(y * width + x) * 4 + 3] = alphas[index];
      }
    }
  }
  return out;
}

/**
 * When the declared mipmap size does not match the stored byte count, Wallpaper
 * Engine occasionally stores a downscaled mip while the container header keeps
 * the original dims. Derive the real dims from the data length when a clean
 * factorization exists; otherwise null.
 */
function deriveDims(storedBytes, width, height, bpp) {
  for (let w = width; w >= 16; w = Math.floor(w / 2)) {
    const bytesPerRow = w * bpp;
    if (storedBytes % bytesPerRow !== 0) continue;
    const h = storedBytes / bytesPerRow;
    if (Number.isInteger(h) && h > 0 && h <= height * 2) return { width: w, height: h };
  }
  return null;
}

/**
 * Decode the first (largest) mipmap of a TEX container.
 *
 * Returns `{ kind: 'jpeg', bytes, width, height }` / `{ kind: 'png-pass',
 * bytes, width, height }` when the mip payload is an embedded JPEG / PNG
 * (Wallpaper Engine stores photographic textures as complete JPEG/PNG files
 * inside the TEX container — returned untouched, zero decode, best fidelity),
 * or `{ kind: 'rgba', width, height, rgba }` for RGBA8888 / R8 / RG88 /
 * DXT1 / DXT3 / DXT5. Embedded MP4 textures and unknown formats throw a
 * descriptive error instead of failing silently.
 */
function decodeTex(data) {
  const parsed = parseTexInternal(data);
  if (parsed.isVideoMp4) {
    throw new Error('tex: video mp4 textures cannot be decoded to a static frame');
  }
  const mip0 = parsed.mipmaps[0];
  // Embedded JPEG texture — pass the payload through untouched.
  if (mip0.bytes.length >= 2 && mip0.bytes[0] === 0xff && mip0.bytes[1] === 0xd8) {
    const dims = jpegSofDims(mip0.bytes);
    return {
      kind: 'jpeg',
      bytes: mip0.bytes,
      width: dims ? dims.width : parsed.width,
      height: dims ? dims.height : parsed.height,
    };
  }
  // Embedded PNG texture (newer WE scenes; photographic art, incl. transparent
  // PNG sprites) — pass the payload through untouched. IHDR dims are
  // big-endian at bytes 16-23.
  if (
    mip0.bytes.length >= 24 &&
    mip0.bytes[0] === 0x89 && mip0.bytes[1] === 0x50 &&
    mip0.bytes[2] === 0x4e && mip0.bytes[3] === 0x47
  ) {
    const ihdrW = (mip0.bytes[16] << 24) | (mip0.bytes[17] << 16) | (mip0.bytes[18] << 8) | mip0.bytes[19];
    const ihdrH = (mip0.bytes[20] << 24) | (mip0.bytes[21] << 16) | (mip0.bytes[22] << 8) | mip0.bytes[23];
    return {
      kind: 'png-pass',
      bytes: mip0.bytes,
      width: ihdrW > 0 ? ihdrW : parsed.width,
      height: ihdrH > 0 ? ihdrH : parsed.height,
    };
  }
  let { width, height, bytes } = mip0;
  // Embedded MP4 / QuickTime video texture (WE "sync" animations flag the TEX
  // as RGBA8888 but store an MP4 file; TEXI flags 0x2000/0x2200 mark them).
  // MP4 boxes start with [u32 big-endian size]['ftyp' ...]. The size sanity
  // check matters: raw RGBA textures can coincidentally start with bytes that
  // spell 'ftyp' in a pixel, but their leading u32 is pixel data, not a box
  // length (raw RGBA at w*h*4 is far larger than any small pixel value).
  if (bytes.length >= 12) {
    const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    if (
      boxSize >= 12 && boxSize <= bytes.length &&
      bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
    ) {
      throw new Error('tex: embedded mp4 video texture cannot be decoded to a static frame');
    }
  }
  switch (parsed.format) {
    case TexFormat.RGBA8888: {
      if (bytes.length < width * height * 4) {
        const derived = deriveDims(bytes.length, width, height, 4);
        if (!derived) throw new Error('tex: mipmap size mismatch for RGBA8888');
        width = derived.width;
        height = derived.height;
      }
      return { kind: 'rgba', width, height, rgba: bytes.slice(0, width * height * 4) };
    }
    case TexFormat.R8: {
      if (bytes.length < width * height) {
        const derived = deriveDims(bytes.length, width, height, 1);
        if (!derived) throw new Error('tex: mipmap size mismatch for R8');
        width = derived.width;
        height = derived.height;
      }
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = bytes[i];
        rgba[i * 4 + 1] = bytes[i];
        rgba[i * 4 + 2] = bytes[i];
        rgba[i * 4 + 3] = 255;
      }
      return { kind: 'rgba', width, height, rgba };
    }
    case TexFormat.RG88: {
      if (bytes.length < width * height * 2) {
        const derived = deriveDims(bytes.length, width, height, 2);
        if (!derived) throw new Error('tex: mipmap size mismatch for RG88');
        width = derived.width;
        height = derived.height;
      }
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = bytes[i * 2];
        rgba[i * 4 + 1] = bytes[i * 2 + 1];
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255;
      }
      return { kind: 'rgba', width, height, rgba };
    }
    case TexFormat.DXT1: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT1');
      return { kind: 'rgba', width, height, rgba: decodeDxt1(bytes, width, height) };
    }
    case TexFormat.DXT3: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT3');
      return { kind: 'rgba', width, height, rgba: decodeDxt3(bytes, width, height) };
    }
    case TexFormat.DXT5: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT5');
      return { kind: 'rgba', width, height, rgba: decodeDxt5(bytes, width, height) };
    }
    default:
      throw new Error('tex: unsupported format ' + parsed.format);
  }
}

// ── PNG encoder (zero dependencies) ──────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 4294967295;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 4294967295) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode RGBA8888 pixels as a minimal PNG (8-bit RGBA, filter type 0) using
 * node:zlib deflate and a hand-rolled CRC32. Zero dependencies.
 */
function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('png: invalid dimensions ' + width + 'x' + height);
  }
  if (rgba.length !== width * height * 4) throw new Error('png: rgba buffer size mismatch');
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Scene pipeline ───────────────────────────────────────────────────────────

/** Extract .tex candidate paths referenced by one scene.json image object. */
function collectImageObjectTextures(imageObject, readJson) {
  const out = [];
  const pushTextureList = (list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const name =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && typeof item.name === 'string'
            ? item.name
            : null;
      if (name && name.toLowerCase().endsWith('.tex')) out.push(name);
    }
  };
  const ref = imageObject.image;
  if (ref.toLowerCase().endsWith('.tex')) out.push(ref);
  else {
    const material = readJson(ref);
    if (material && Array.isArray(material.passes)) {
      for (const pass of material.passes) pushTextureList(pass && pass.textures);
    }
  }
  const instance = imageObject.instance;
  if (instance && typeof instance === 'object') pushTextureList(instance.textures);
  return out;
}

/** SceneAccess over a packed scene.pkg container (case-insensitive paths). */
function pkgSceneAccess(pkgData) {
  const entries = parsePkg(pkgData);
  const byPath = new Map(entries.map((entry) => [entry.path.toLowerCase(), entry]));
  const readFile = (path) => {
    const entry = byPath.get(path.toLowerCase());
    if (!entry) return null;
    return { path: entry.path, bytes: readPkgEntry(pkgData, entry) };
  };
  return {
    readJson: (path) => {
      const file = readFile(path);
      if (!file) return null;
      try {
        return JSON.parse(textDecoder.decode(file.bytes));
      } catch {
        return null;
      }
    },
    readFile,
    listTexPaths: () => entries.filter((entry) => entry.path.toLowerCase().endsWith('.tex')).map((entry) => entry.path),
  };
}

/**
 * SceneAccess over a loose scene project directory (scene.json plus loose
 * .tex/.json files, e.g. WE defaultprojects). Reads are fenced inside the
 * directory; texture references escaping it resolve to null.
 */
function dirSceneAccess(dir) {
  const readFile = (path) => {
    const abs = resolve(dir, path);
    if (abs !== dir && !abs.startsWith(dir + sep)) return null;
    try {
      if (!statSync(abs).isFile()) return null;
      return { path, bytes: new Uint8Array(readFileSync(abs)) };
    } catch {
      return null;
    }
  };
  const listTexPaths = () => {
    const out = [];
    const walk = (sub, depth) => {
      if (depth > 4) return;
      let names = [];
      try {
        names = readdirSync(sub === '' ? dir : join(dir, sub));
      } catch {
        return;
      }
      for (const name of names) {
        const rel = sub === '' ? name : sub + '/' + name;
        let isDir = false;
        let isFile = false;
        try {
          const stat = statSync(join(dir, rel));
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
        if (isDir) walk(rel, depth + 1);
        else if (isFile && name.toLowerCase().endsWith('.tex')) out.push(rel);
      }
    };
    walk('', 0);
    return out;
  };
  return {
    readJson: (path) => {
      const file = readFile(path);
      if (!file) return null;
      try {
        return JSON.parse(textDecoder.decode(file.bytes));
      } catch {
        return null;
      }
    },
    readFile,
    listTexPaths,
  };
}

/**
 * Shared scene pipeline over one access layer; label prefixes error text.
 *
 * Candidate order: textures referenced by the first scene object with an
 * `image` property first, then every other .tex ranked by a score that favors
 * wallpaper art — embedded JPEG/PNG payloads (WE only lossy-encodes
 * photographic art), full-color formats (RGBA8888/RGB888), and large areas —
 * while masks, depth/normal/effect helpers, R8/RG88 grayscale formats and
 * embedded workshop asset folders are heavily penalized.
 *
 * A post-decode quality gate rejects grayscale (>88% gray) and flat (near-zero
 * variance) frames — a mask/depth texture can never be the wallpaper — and
 * moves on to the next candidate. When nothing passes, the caller sees an
 * error and falls back to the project preview.
 *
 * Returns `{ mime, bytes, width, height, texturePath }`.
 */
const PATH_PENALTY_RE =
  /(^|[\\/])(masks?|effects?)([\\/]|$)|[\\/]workshop[\\/]|_mask|mask_|normal|depth|ripple|foliagesway|cloudmotion|shake|pulse|xray|opacity|lens|cursor|flow|grad|noise|particle|vignette|blur|sync|_anim|frame|seq/i;
/** Format → art-likelihood multiplier (embedded JPEG/PNG handled separately). */
const FORMAT_PENALTY = {
  0: 1, // RGBA8888
  1: 1, // RGB888
  7: 0.5, // DXT1
  6: 0.5, // DXT3
  4: 0.5, // DXT5
  8: 0.01, // RG88 — grayscale helper
  9: 0.01, // R8 — grayscale helper
  2: 0.1, // RGB565
  12: 0.05, // BC7
  13: 0.1, // RGBA1010102
  10: 0.05, 11: 0.05, 14: 0.05, 15: 0.05, // float formats
};

/** Sample the decoded frame: grayscale ratio + mean channel variance. */
function frameQuality(width, height, rgba) {
  const total = width * height;
  const n = Math.min(2000, total);
  const seen = new Set();
  let gray = 0, sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    let idx;
    do { idx = (Math.random() * total) | 0; } while (seen.has(idx));
    seen.add(idx);
    const o = idx * 4;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    sr += r; sg += g; sb += b;
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 24) gray++;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  let v = 0;
  for (const idx of seen) {
    const o = idx * 4;
    v += Math.abs(rgba[o] - mr) + Math.abs(rgba[o + 1] - mg) + Math.abs(rgba[o + 2] - mb);
  }
  return { grayRatio: gray / n, meanVar: v / (n * 3) };
}

/** The quality gate: reject grayscale masks/depth and flat solid fills. */
function isAcceptableFrame(q) {
  if (q.grayRatio > 0.88) return false;
  if (q.meanVar < 3) return false;
  return true;
}

/**
 * Quality-check an embedded-PNG payload WITHOUT committing to it: decode
 * (8-bit RGB/RGBA only) and run the same grayscale/flat gate. Payloads larger
 * than PNG_GATE_MAX_PIXELS are trusted (bounding decode memory); returns null
 * then, or on any parse failure — the caller treats null as "accept".
 */
const PNG_GATE_MAX_PIXELS = 12 * 1024 * 1024;

function pngQuality(bytes) {
  const b = Buffer.from(bytes);
  if (!(b.length >= 33 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG')) return null;
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const ct = b[25];
  const channels = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (w <= 0 || h <= 0 || w > 16384 || h > 16384 || !channels || w * h > PNG_GATE_MAX_PIXELS) return null;
  const idats = [];
  let p = 8;
  while (p < b.length) {
    if (p + 12 > b.length) return null;
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    if (p + 12 + len > b.length) return null;
    if (type === 'IDAT') idats.push(b.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!idats.length) return null;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idats));
  } catch {
    return null;
  }
  const stride = w * channels + 1;
  if (raw.length < stride * h) return null;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride];
    const line = raw.subarray(y * stride + 1, (y + 1) * stride);
    for (let x = 0; x < w * channels; x++) {
      const a = x >= channels ? rgba[y * w * 4 + x - channels] : 0;
      const pr = y > 0 ? rgba[(y - 1) * w * 4 + x] : 0;
      const pc = y > 0 && x >= channels ? rgba[(y - 1) * w * 4 + x - channels] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + pr) & 255;
      else if (f === 3) v = (v + ((a + pr) >> 1)) & 255;
      else if (f === 4) {
        const q = a + pr - pc;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - pr);
        const pcv = Math.abs(q - pc);
        v = (v + (pa <= pb && pa <= pcv ? a : pb <= pcv ? pr : pc)) & 255;
      }
      rgba[y * w * 4 + x] = v;
    }
  }
  return frameQuality(w, h, rgba);
}

function extractSceneMainImageVia(access, label) {
  const scene = access.readJson('scene.json');
  if (!scene || !Array.isArray(scene.objects)) {
    throw new Error(label + ': scene.json not found or invalid');
  }
  const candidates = [];
  const imageObject = scene.objects.find(
    (o) => !!o && typeof o === 'object' && typeof o.image === 'string'
  );
  if (imageObject) candidates.push(...collectImageObjectTextures(imageObject, access.readJson));

  // Rank the rest of the package's textures by art-likelihood score.
  const ranked = [];
  for (const path of access.listTexPaths()) {
    let score = 0;
    try {
      const file = access.readFile(path);
      const info = file ? parseTex(file.bytes) : null;
      if (info && !info.isVideoMp4) {
        const area = info.width * info.height;
        const embedded = info.embedded === 'jpeg' || info.embedded === 'png' ? 1 : FORMAT_PENALTY[info.format] ?? 0.05;
        const pathPenalty = PATH_PENALTY_RE.test(path) ? 0.02 : 1;
        score = area * embedded * pathPenalty;
      }
    } catch {
      score = 0;
    }
    ranked.push({ path, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  for (const { path } of ranked) {
    if (!candidates.some((c) => c.toLowerCase() === path.toLowerCase())) candidates.push(path);
  }
  if (candidates.length === 0) throw new Error(label + ': no texture candidates found');

  let lastError = null;
  for (const path of candidates) {
    const file = access.readFile(path);
    if (!file) {
      lastError = new Error(label + ": texture '" + path + "' not found in " + (label === 'pkg' ? 'package' : 'directory'));
      continue;
    }
    try {
      const decoded = decodeTex(file.bytes);
      if (decoded.kind === 'jpeg') {
        // Embedded JPEG payloads are photographic art by construction — WE
        // never stores masks/helpers as JPEG. Pass through untouched.
        return {
          mime: 'image/jpeg',
          bytes: decoded.bytes,
          width: decoded.width,
          height: decoded.height,
          texturePath: file.path,
        };
      }
      if (decoded.kind === 'png-pass') {
        // Embedded PNGs are usually art, but some scenes store grayscale
        // variants (b/w edits, gray backgrounds) — quality-gate when cheap.
        const q = pngQuality(decoded.bytes);
        if (q && !isAcceptableFrame(q)) {
          lastError = new Error(
            label + ': frame rejected (' + file.path + '): gray=' + Math.round(q.grayRatio * 100) + '% var=' + q.meanVar.toFixed(1)
          );
          continue;
        }
        return {
          mime: 'image/png',
          bytes: decoded.bytes,
          width: decoded.width,
          height: decoded.height,
          texturePath: file.path,
        };
      }
      // Raw RGBA — apply the quality gate before committing to it.
      const q = frameQuality(decoded.width, decoded.height, decoded.rgba);
      if (!isAcceptableFrame(q)) {
        lastError = new Error(
          label + ': frame rejected (' + file.path + '): gray=' + Math.round(q.grayRatio * 100) + '% var=' + q.meanVar.toFixed(1)
        );
        continue;
      }
      return {
        mime: 'image/png',
        bytes: encodePng(decoded.width, decoded.height, decoded.rgba),
        width: decoded.width,
        height: decoded.height,
        texturePath: file.path,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(label + ': no decodable texture found');
}

/** Extract the main static frame of a packed scene.pkg (Uint8Array/Buffer). */
function extractSceneMainImage(pkgData) {
  return extractSceneMainImageVia(pkgSceneAccess(pkgData), 'pkg');
}

/**
 * Loose-scene variant: decode the main texture of a scene project directory
 * that ships scene.json and textures as plain files instead of a packed
 * scene.pkg.
 */
function extractSceneMainImageFromDir(dir) {
  return extractSceneMainImageVia(dirSceneAccess(dir), 'scene');
}

export { extractSceneMainImage, extractSceneMainImageFromDir, parsePkg, readPkgEntry, parseTex };
