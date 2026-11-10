/**
 * media-size.js — 壁纸方向筛选用的**轻量尺寸探测**（图片文件头 + MP4 tkhd）。
 *
 * 为什么不复用 `getMediaInfo`：那套 MP4 探测为取 codec / fps 会读头尾各 8 MB；
 * 清单要为每一张视频壁纸算方向，冷启动时放大成"每张最多 16 MB"不可接受。这里只找
 * `moov/trak/tkhd` 并读末尾的 width/height，命中缓存后不再读盘。
 *
 * 支持：
 *   · 图片：PNG / JPEG / WebP（VP8X / VP8 / VP8L）/ GIF —— 读文件头即可；
 *   · 视频：MP4 / MOV 的 tkhd 宽高（16.16 定点，取整数部分）。
 *
 * 探测失败一律返回 null（调用方按「方向未知」处理，只在「全部方向」里显示）。
 * 缓存键含 size + mtime：文件被覆盖后自然失效。
 */
import { open as fspOpen, stat as fspStat } from 'node:fs/promises';

const CACHE = new Map();
const CACHE_MAX = 4096;
/** 单次补读 `moov` 的硬上限：超过它的盒子一律放弃（伪造 `size=0` 不再整段读文件）。 */
const MAX_BOX_READ_BYTES = 8 * 1024 * 1024;
/** 每个文件最多补读几次（头窗口 + 尾窗口各一次就够，多出来的必是伪造）。 */
const MAX_BOX_READS = 2;

function cacheGet(key) {
  if (!CACHE.has(key)) return undefined;
  const value = CACHE.get(key);
  CACHE.delete(key);
  CACHE.set(key, value);
  return value;
}

function cacheSet(key, value) {
  CACHE.set(key, value);
  if (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
}


function dims(width, height) {
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * EXIF `Orientation` (tag 0x0112) from a JPEG's APP1 segment, or 0 when absent.
 * Only the 8 orientations matter here: 5–8 are the transposed ones (width and
 * height swap), 2/3/4 are pure mirrors/flips and keep the stored aspect.
 */
export function jpegExifOrientation(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 0;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return 0;
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) return 0;  // scan starts: no APP1
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return 0;
    // APP1 with the "Exif\0\0" signature holds the TIFF block.
    if (marker === 0xe1 && len >= 8
      && buf.toString('latin1', i + 4, i + 10) === 'Exif\u0000\u0000') {
      const tiff = i + 10;
      const le = buf.toString('latin1', tiff, tiff + 2) === 'II';
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      if (u16(tiff + 2) !== 42) return 0;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > buf.length) return 0;
      const count = u16(ifd);
      for (let e = 0; e < count; e += 1) {
        const at = ifd + 2 + e * 12;
        if (at + 12 > buf.length) return 0;
        if (u16(at) === 0x0112) {
          const value = u16(at + 8);
          return value >= 1 && value <= 8 ? value : 0;
        }
      }
      return 0;
    }
    i += 2 + len;
  }
  return 0;
}

/** Apply an EXIF orientation: 5–8 store a transposed image. */
function applyOrientation(size, orientation) {
  if (!size || !(orientation >= 5 && orientation <= 8)) return size;
  return { width: size.height, height: size.width };
}

/** Parse image dimensions from a header buffer. Exported for the guard's
 *  synthetic fixtures (no file I/O). */
export function parseImageSize(buf) {
  if (!buf || buf.length < 10) return null;
  // PNG: signature + IHDR (width/height big-endian at 16..24)
  if (buf.length >= 24
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf.toString('latin1', 12, 16) === 'IHDR') {
    return dims(buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  // GIF: 'GIF87a' / 'GIF89a', logical screen width/height little-endian at 6/8
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'GIF') {
    return dims(buf.readUInt16LE(6), buf.readUInt16LE(8));
  }
  // WebP: RIFF....WEBP + VP8X / VP8 / VP8L
  if (buf.length >= 20
    && buf.toString('latin1', 0, 4) === 'RIFF'
    && buf.toString('latin1', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('latin1', 12, 16);
    if (fourcc === 'VP8X' && buf.length >= 30) {
      return dims(buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1);
    }
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
      return dims(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
    }
    if (fourcc === 'VP8L' && buf.length >= 25) {
      if (buf[20] !== 0x2f) return null;
      const bits = buf.readUInt32LE(21);
      return dims((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    return null;
  }
  // JPEG: walk markers until a SOFn frame header.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01
        || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (i + 9 > buf.length) return null;
        // 手机竖拍常把像素存成横的、靠 EXIF Orientation 6/8 转正 —— 方向筛选必须按**显示**方向判。
        return applyOrientation(
          dims(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)),
          jpegExifOrientation(buf),
        );
      }
      if (marker === 0xda) return null; // start of scan: no SOF seen
      i += 2 + len;
    }
  }
  return null;
}

function boxAt(buf, off) {
  if (off + 8 > buf.length) return null;
  let size = buf.readUInt32BE(off);
  const type = buf.toString('latin1', off + 4, off + 8);
  let header = 8;
  if (size === 1) {
    if (off + 16 > buf.length) return null;
    size = Number(buf.readBigUInt64BE(off + 8));
    header = 16;
  } else if (size === 0) {
    size = buf.length - off;
  }
  if (size < header || off + size > buf.length) return null;
  return { off, size, type, header };
}

function childBoxes(buf, box) {
  const out = [];
  let off = box.off + box.header;
  const end = box.off + box.size;
  while (off + 8 <= end) {
    const child = boxAt(buf, off);
    if (!child || child.off !== off) break;
    out.push(child);
    off += child.size;
  }
  return out;
}

/**
 * `tkhd` ends with matrix(36) + width(4) + height(4), the last two 16.16 fixed.
 * A phone recording portrait often stores landscape pixels plus a 90°/270°
 * matrix; the matrix's a/b/c/d signs tell us the **displayed** orientation, so
 * width/height must be swapped for those.
 */
function tkhdDims(buf, tkhd) {
  const end = tkhd.off + tkhd.size;
  if (end - 8 < tkhd.off) return null;
  const width = buf.readUInt32BE(end - 8) >>> 16;
  const height = buf.readUInt32BE(end - 4) >>> 16;
  const size = dims(width, height);
  if (!size) return null;
  // Matrix starts 44 bytes before the end (36 matrix + 4 + 4), each entry 16.16 signed.
  const matrixAt = end - 44;
  if (matrixAt < tkhd.off) return size;
  const a = buf.readInt32BE(matrixAt) / 65536;
  const b = buf.readInt32BE(matrixAt + 4) / 65536;
  // Rotated 90°/270° ⇒ the stored width/height are swapped relative to display.
  if (Math.abs(b) > 0.5) return { width: size.height, height: size.width };
  if (Math.abs(a) <= 0.5) return size;   // degenerate matrix: keep the stored values
  return size;
}

function moovDims(buf, moov) {
  for (const trak of childBoxes(buf, moov)) {
    if (trak.type !== 'trak') continue;
    for (const tkhd of childBoxes(buf, trak)) {
      if (tkhd.type !== 'tkhd') continue;
      const found = tkhdDims(buf, tkhd);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Walk the top-level box chain looking for `moov`, then read only that box.
 *
 * 不变量（伪造 moov 的加固）：
 *   · **只沿 box 链走**（`off += size`），绝不逐字节扫 —— 否则每 8 字节一个伪 `moov`
 *     就能放大成几十万次候选；
 *   · 单次读盘有硬上限 `MAX_BOX_READ_BYTES`，且每个文件最多读 `MAX_BOX_READS` 次 ——
 *     声明 `size = 0`（= 到文件尾）的伪盒子不会把整个 200 MB 文件读进内存；
 *   · 盒子超出窗口就按上限**定长**读，不按 `size` 整段 alloc。
 *
 * @param {Buffer} buf 已读入的窗口（文件头或文件尾）
 * @param {number} fileSize 文件总长
 * @param {((absOffset: number, size: number) => Buffer | null | Promise<Buffer | null>)} [readBox] 窗口外补读
 * @param {number} [baseOffset] `buf` 在文件里的起始偏移
 */
export async function parseVideoSize(buf, fileSize, readBox, baseOffset = 0) {
  if (!buf || buf.length < 16) return null;
  const limit = baseOffset + buf.length;
  let reads = 0;
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > buf.length) return null;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = fileSize - (baseOffset + off);   // "to end of file"
    }
    if (!(size >= header)) return null;
    const absOff = baseOffset + off;
    if (absOff + size > fileSize) return null;
    if (type !== 'moov') { off += size; continue; }

    let boxBuf = null;
    if (absOff + size <= limit) {
      boxBuf = buf.subarray(off, off + size);
    } else if (typeof readBox === 'function' && reads < MAX_BOX_READS) {
      reads += 1;
      const want = Math.min(size, MAX_BOX_READ_BYTES);
      boxBuf = await readBox(absOff, want);
      // 读回来的比声明短 ⇒ 不是完整盒子（伪造或跨窗口截断），放弃这条候选。
      if (boxBuf && boxBuf.length < size) boxBuf = null;
    }
    if (!boxBuf) return null;
    const moov = boxAt(boxBuf, 0);
    if (!moov || moov.type !== 'moov') return null;
    const found = moovDims(boxBuf, moov);
    if (found) return found;
    off += size;
  }
  return null;
}

/** Dimensions of a local image / video, or null when it cannot be determined. */
export async function mediaSizeOf(abs, type) {
  if (!abs || (type !== 'image' && type !== 'video')) return null;
  let st;
  try { st = await fspStat(abs); } catch { return null; }
  const key = abs + '|' + st.size + '|' + Math.round(st.mtimeMs) + '|' + type;
  if (CACHE.has(key)) return cacheGet(key);
  let handle = null;
  const readRange = async (offset, length) => {
    const start = Math.max(0, Math.min(offset, st.size));
    const len = Math.max(0, Math.min(length, st.size - start, MAX_BOX_READ_BYTES));
    if (!len) return Buffer.alloc(0);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await handle.read(buf, 0, len, start);
    return bytesRead === len ? buf : buf.subarray(0, bytesRead);
  };
  let result;
  try {
    handle = await fspOpen(abs, 'r');
    if (type === 'image') {
      let buf = await readRange(0, 32 * 1024);
      result = parseImageSize(buf);
      if (!result && st.size > buf.length) {
        buf = await readRange(0, 1024 * 1024);
        result = parseImageSize(buf);
      }
    } else {
      const headLen = Math.min(st.size, 256 * 1024);
      const head = await readRange(0, headLen);
      const readBox = (offset, size) => readRange(offset, size);
      result = await parseVideoSize(head, st.size, readBox, 0);
      if (!result && st.size > headLen) {
        const tailLen = Math.min(st.size, 8 * 1024 * 1024);
        const tail = await readRange(st.size - tailLen, tailLen);
        result = await parseVideoSize(tail, st.size, readBox, st.size - tailLen);
      }
    }
  } catch {
    result = null;
  } finally {
    try { if (handle) await handle.close(); } catch { /* ignore */ }
  }
  cacheSet(key, result);
  return result;
}
