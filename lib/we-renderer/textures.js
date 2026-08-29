// WE 渲染引擎 — 资源读取 (scene.pkg / 松散目录) 与纹理加载
import fs from 'node:fs';
import path from 'node:path';
import { decodePngBuffer } from './canvas.js';
import { parseTex, decodeTex, readPkgEntry } from '../pkg-extract.js';
import { decodeJpeg } from './jpeg.js';

// ── 松散 scene.json 目录访问器 ──────────────────────────────────
export function readPkgDir(dir) {
  const exists = (p) => fs.existsSync(path.join(dir, p));
  const read = (p) => {
    const f = path.join(dir, p);
    if (!fs.existsSync(f)) return null;
    return fs.readFileSync(f); // Buffer (兼容 toString('ascii') 等)
  };
  const readJson = (p) => { const b = read(p); return b ? JSON.parse(b.toString('utf8')) : null; };
  return {
    has: exists,
    entries: () => [],
    read,
    readJson,
    readText: (p) => { const b = read(p); return b ? b.toString('utf8') : null; },
  };
}

// ── scene.pkg 容器 ──────────────────────────────────────────────
// BASE-08: LZ4 链条目探测 (pkg-extract.js probeCompressedEntry 同款): int64 原始
// 大小 + [i32 decompressed][i32 compressed][LZ4 block]*, 精确吻合才视为压缩条目 —
// 部分打包器如此存储, 旧实现按原始字节读 → LZ4 包纹理乱读/静默跳层
function probeLz4Chain(dv, abs, length) {
  if (length < 8) return null;
  const originalSize = dv.getUint32(abs, true) + dv.getUint32(abs + 4, true) * 4294967296;
  if (originalSize <= length || originalSize > 2147483647) return null;
  let pos = abs + 8;
  let total = 0;
  while (total < originalSize) {
    if (pos + 8 > abs + length) return null;
    const uncomp = dv.getInt32(pos, true);
    const comp = dv.getInt32(pos + 4, true);
    if (uncomp <= 0 || comp <= 0 || pos + 8 + comp > abs + length) return null;
    total += uncomp;
    pos += 8 + comp;
  }
  return total === originalSize && pos === abs + length ? originalSize : null;
}
export function readPkg(pkgPath) {
  const buf = fs.readFileSync(pkgPath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;
  // PKGV 容器: 支持两种头部布局
  // 旧: "PKGV" + u32 version + u32 count
  // 新: u32 ? + "PKGV0022" + u32 count (magic 在 offset 4)
  const magicAt0 = buf.toString('latin1', 0, 4);
  const magicAt4 = buf.toString('latin1', 4, 8);
  let count;
  let oldFormat = false;
  if (magicAt0 === 'PKGV') {
    oldFormat = true;
    pos = 4;
    pos += 4; // version
    count = dv.getInt32(pos, true); pos += 4;
  } else if (magicAt4 === 'PKGV') {
    // 新格式: [u32?][PKGV + 4 字符版本][u32 count] — magic 8 字节 (4-11), count @ 12
    pos = 12;
    count = dv.getInt32(pos, true); pos += 4;
  } else {
    throw new Error('not a PKGV container');
  }
  if (count <= 0 || count > 100000) throw new Error('invalid entry count ' + count);
  const entries = [];
  for (let i = 0; i < count; i++) {
    // name: u32 长度 + 字符串 (不 4 对齐; 字节级验证: nameLen@16=10, name@20-29, 直接接字段)
    const nameLen = dv.getInt32(pos, true); pos += 4;
    if (nameLen <= 0 || nameLen > 500) throw new Error('invalid name length ' + nameLen);
    const name = buf.toString('utf8', pos, pos + nameLen);
    pos += nameLen;
    // 条目字段: u32 offset + u32 size (小端)
    // 字节级验证 (PKGV0018, 2934788040): scene.json offset@30-33=0 size@34-37=3840;
    // materials/图层 2.tex offset@64-67=3840 size@68-71=2377110
    const offset = dv.getUint32(pos, true);
    const size = dv.getUint32(pos + 4, true);
    entries.push({ name, offset, size });
    pos += 8;
  }
  // 数据区起点 = 描述区结束 (新格式 offset 相对数据区)
  const dataStart = pos;
  const map = new Map(entries.map((e) => [e.name, e]));
  const read = (p) => {
    const e = map.get(p);
    if (!e) return null;
    // 新格式 (PKGV@4): offset 一律相对 dataStart; 旧格式 (PKGV@0): 绝对偏移
    const abs = oldFormat ? e.offset : dataStart + e.offset;
    if (abs + e.size > buf.length) return null;
    // BASE-08: LZ4 链条目 → pkg-extract 硬化 readPkgEntry 解压 (flags=1);
    // 解压失败按缺失处理 (与普通条目越界同款容错)
    const orig = probeLz4Chain(dv, abs, e.size);
    if (orig == null) return Buffer.from(buf.buffer, buf.byteOffset + abs, e.size);
    try {
      return Buffer.from(readPkgEntry(buf, { path: e.name, offset: abs, compressedSize: e.size, size: orig, flags: 1 }));
    } catch { return null; }
  };
  const readJson = (p) => {
    const b = read(p);
    return b ? JSON.parse(b.toString('utf8')) : null;
  };
  return {
    has: (p) => map.has(p),
    entries: () => entries,
    read,
    readJson,
    readText: (p) => { const b = read(p); return b ? b.toString('utf8') : null; },
  };
}

// ── TEX 头 flags (官方 Texture.h: NoInterpolation=1, ClampUVs=2, IsGif=4,
// ClampUVsBorder=8, Video=32) — wrap 裁决数据源: CTexture.cpp:176-183,
// flags & ClampUVs → GL_CLAMP_TO_EDGE, 否则 GL_REPEAT ──
// TEXI 布局: "TEXV0005"(16B) + "TEXI0001"(16B) + format u32@32 + flags u32@36 (小端)
export function parseTexFlags(raw) {
  if (!raw || raw.length < 40) return null;
  const m = (i) => String.fromCharCode(raw[i], raw[i + 1], raw[i + 2], raw[i + 3]);
  if (m(0) !== 'TEXV' || m(16) !== 'TEXI') return null;
  const flags = (raw[36] | (raw[37] << 8) | (raw[38] << 16) | (raw[39] << 24)) >>> 0;
  return { flags, clampUV: (flags & 2) !== 0 }; // 2 = ClampUVs
}

// ── 纹理解码 (TEXV 容器 → {width, height, rgba, frames?}) ──────
// BASE-23: 旧实现的 try { ... } catch (e) { throw e; } 是无效包装, 已删;
// 注: parseTex + decodeTex 仍各解析一遍容器 (pkg-extract decodeTex 不收预解析
// info, 该文件不在修复范围 → 见 deferred 清单)
export function loadTexImage(raw) {
  const info = parseTex(raw);
  const dec = decodeTex(raw);
  let width, height, rgba;
  if (dec.kind === 'png-pass') {
    const img = decodePngBuffer(Buffer.from(dec.bytes));
    width = img.width; height = img.height; rgba = img.rgba;
  } else if (dec.kind === 'jpeg') {
    const img = decodeJpeg(dec.bytes);
    width = img.width; height = img.height; rgba = img.rgba;
  } else {
    ({ width, height, rgba } = dec);
  }
  // 逻辑尺寸裁剪 (DXT padding)
  if (width !== info.width || height !== info.height) {
    const srcW = width;
    width = info.width; height = info.height;
    const cropped = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) cropped.set(rgba.subarray(y * srcW * 4, y * srcW * 4 + width * 4), y * width * 4);
    rgba = cropped;
  }
  // 精灵图帧元数据 (TEXS: 帧数/时长/布局) — spritesheet 动画用
  // BASE-24: duration 取全帧平均 (旧: 仅首帧 frametime — 变帧率素材整段按
  // 首帧速率播放); 完整逐帧时序需消费端 (image.js 按累计时间选帧) 配合,
  // 该文件不在本包修复范围 → 见 deferred 清单
  let frames = null;
  if (info.frames && info.frames.length > 1) {
    let total = 0, known = 0;
    for (const f of info.frames) {
      const d = Number(f && f.frametime);
      if (Number.isFinite(d) && d > 0) { total += d; known++; }
    }
    frames = {
      count: info.frames.length,
      duration: known ? total / known : 0.1,
      items: info.frames,
    };
  }
  // TEX flags → 纹理对象携带 clampUV (官方 wrap 裁决: ClampUVs → CLAMP_TO_EDGE, 否则
  // REPEAT)。消费点: model.js _texSample 第 4 参 (clamp) 未显式传入时应默认
  // tex.clampUV === true (显式传入优先) — 该文件不在本次修复范围, 待其配合接入;
  // core.js loadTexture 原样透传/缓存本对象, flags 字段随返回值生效
  const tf = parseTexFlags(raw);
  return { width, height, rgba, frames, flags: tf ? tf.flags : 0, clampUV: tf ? tf.clampUV : false };
}

export function loadPngFile(p) {
  const b = fs.readFileSync(p);
  return decodePngBuffer(b);
}
