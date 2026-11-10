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
import { closeSync, existsSync, fstatSync, openSync, readSync, statSync } from 'node:fs';

const CACHE = new Map();
const CACHE_MAX = 4096;

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

function readAt(abs, offset, length) {
  const fd = openSync(abs, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, Math.min(offset, size));
    const len = Math.max(0, Math.min(length, size - start));
    if (!len) return Buffer.alloc(0);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    return buf;
  } finally {
    closeSync(fd);
  }
}

function dims(width, height) {
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Parse image dimensions from a header buffer. Exported for the guard's
 * synthetic fixtures (no file I/O).
 */
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
        return dims(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
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

function tkhdDims(buf, tkhd) {
  const end = tkhd.off + tkhd.size;
  if (end - 8 < tkhd.off) return null;
  // tkhd ends with matrix(36) + width(4) + height(4), both 16.16 fixed point.
  return dims(buf.readUInt32BE(end - 8) >>> 16, buf.readUInt32BE(end - 4) >>> 16);
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
 * Scan a buffer for a `moov` box and return the tkhd dimensions. Exported for
 * the guard's synthetic MP4 fixtures.
 * @param {Buffer} buf
 * @param {number} fileSize
 * @param {(absOffset: number, size: number) => Buffer | null} [readBox]
 * @param {number} [baseOffset]
 */
export function parseVideoSize(buf, fileSize, readBox, baseOffset = 0) {
  if (!buf || buf.length < 16) return null;
  for (let i = 0; i + 8 <= buf.length; i += 1) {
    if (buf.toString('latin1', i + 4, i + 8) !== 'moov') continue;
    let size = buf.readUInt32BE(i);
    if (size === 1) {
      if (i + 16 > buf.length) continue;
      size = Number(buf.readBigUInt64BE(i + 8));
    } else if (size === 0) {
      size = fileSize - (baseOffset + i);
    }
    if (!(size >= 8) || baseOffset + i + size > fileSize) continue;
    let boxBuf = null;
    if (i + size <= buf.length) {
      boxBuf = buf.subarray(i, i + size);
    } else if (typeof readBox === 'function') {
      boxBuf = readBox(baseOffset + i, size);
    }
    if (!boxBuf) continue;
    const moov = boxAt(boxBuf, 0);
    if (!moov || moov.type !== 'moov') continue;
    const found = moovDims(boxBuf, moov);
    if (found) return found;
  }
  return null;
}

/** Dimensions of a local image / video, or null when it cannot be determined. */
export function mediaSizeOf(abs, type) {
  if (!abs || (type !== 'image' && type !== 'video') || !existsSync(abs)) return null;
  let st;
  try { st = statSync(abs); } catch { return null; }
  const key = abs + '|' + st.size + '|' + Math.round(st.mtimeMs) + '|' + type;
  if (CACHE.has(key)) return cacheGet(key);
  let result = null;
  try {
    if (type === 'image') {
      let buf = readAt(abs, 0, Math.min(st.size, 32 * 1024));
      result = parseImageSize(buf);
      if (!result && st.size > buf.length) {
        buf = readAt(abs, 0, Math.min(st.size, 1024 * 1024));
        result = parseImageSize(buf);
      }
    } else {
      const headLen = Math.min(st.size, 256 * 1024);
      const head = readAt(abs, 0, headLen);
      result = parseVideoSize(head, st.size, (offset, size) => readAt(abs, offset, size), 0);
      if (!result && st.size > headLen) {
        const tailLen = Math.min(st.size, 8 * 1024 * 1024);
        const tail = readAt(abs, st.size - tailLen, tailLen);
        result = parseVideoSize(tail, st.size, (offset, size) => readAt(abs, offset, size), st.size - tailLen);
      }
    }
  } catch {
    result = null;
  }
  cacheSet(key, result);
  return result;
}
