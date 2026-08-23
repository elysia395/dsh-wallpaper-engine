// WE 渲染引擎 — 资源读取 (scene.pkg / 松散目录) 与纹理加载
import fs from 'node:fs';
import path from 'node:path';
import { decodePngBuffer } from './canvas.js';
import { parseTex, decodeTex } from '../pkg-extract.js';

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
export function readPkg(pkgPath) {
  const buf = fs.readFileSync(pkgPath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const readEntry = (pos) => {
    const offset = dv.getUint32(pos, true);
    const size = dv.getUint32(pos + 4, true);
    return { offset, size };
  };
  const rstr = () => {
    const count = dv.getInt32(pos, true); pos += 4;
    const s = buf.toString('utf8', pos, pos + count);
    pos += count;
    return s;
  };
  let pos = 0;
  const magic = buf.toString('latin1', 0, 4);
  if (magic !== 'PKGV') throw new Error('not a PKGV container');
  pos = 4;
  const version = dv.getInt32(pos, true); pos += 4;
  const count = dv.getInt32(pos, true); pos += 4;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const name = rstr();
    const { offset, size } = readEntry(pos);
    entries.push({ name, offset, size });
  }
  const map = new Map(entries.map((e) => [e.name, e]));
  const read = (p) => {
    const e = map.get(p);
    if (!e) return null;
    // Buffer 视图 (兼容 toString('ascii') 等 Buffer 方法)
    return Buffer.from(buf.buffer, buf.byteOffset + e.offset, e.size);
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

// ── 纹理解码 (TEXV 容器 → {width, height, rgba, frames?}) ──────
export function loadTexImage(raw) {
  try {
    const info = parseTex(raw);
    const dec = decodeTex(raw);
    let width, height, rgba;
    if (dec.kind === 'png-pass') {
      const img = decodePngBuffer(Buffer.from(dec.bytes));
      width = img.width; height = img.height; rgba = img.rgba;
    } else if (dec.kind === 'jpeg') {
      return null;
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
    let frames = null;
    if (info.frames && info.frames.length > 1) {
      frames = {
        count: info.frames.length,
        duration: info.frames[0].frametime || 0.1,
        items: info.frames,
      };
    }
    return { width, height, rgba, frames };
  } catch (e) {
    throw e;
  }
}

export function loadPngFile(p) {
  const b = fs.readFileSync(p);
  return decodePngBuffer(b);
}
