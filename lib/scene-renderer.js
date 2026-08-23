// 场景壁纸渲染器 (单文件版)
// 参考 Almamu/linux-wallpaperengine + notscuffed/repkg
// scene.pkg → 对象树: image(纹理+shader效果CPU实现) + particle(完整模拟) + puppet(MDL网格)
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { parseTex, decodeTex } from './pkg-extract.js';
import { parseCffFont, renderText } from './font-render.js';
import { applySceneScripts } from './scene-scripts.js';

// 松散 scene.json 目录访问器: 提供与 readPkg 相同的接口 (has/entries/read/readJson/readText)
export function readPkgDir(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = (d + '/' + e.name).replace(/\\/g, '/');
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  try { walk(dir); } catch { /* ignore */ }
  const rel = files.map((f) => f.slice(dir.length + 1));
  const byPath = new Map(rel.map((r) => [r, dir + '/' + r]));
  return {
    has(p) { return byPath.has(p.replace(/\\/g, '/')); },
    entries() { return rel; },
    read(p) {
      const key = p.replace(/\\/g, '/');
      const f = byPath.get(key);
      if (!f) return null;
      try { return fs.readFileSync(f); } catch { return null; }
    },
    readJson(p) { const b = this.read(p); return b ? JSON.parse(b.toString('utf8')) : null; },
    readText(p) { const b = this.read(p); return b ? b.toString('utf8') : null; },
  };
}

export function readPkg(path) {
  const data = fs.readFileSync(path);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const rstr = () => { const len = dv.getInt32(pos, true); pos += 4; const s = data.toString('utf8', pos, pos + len); pos += len; return s; };
  rstr(); const count = dv.getInt32(pos, true); pos += 4;
  const entries = [];
  for (let i = 0; i < count; i++) { const p = rstr(); const off = dv.getUint32(pos, true); const len = dv.getUint32(pos + 4, true); pos += 8; entries.push({ p, off, len }); }
  const dataStart = pos;
  const byPath = new Map(entries.map((e) => [e.p, e]));
  function lz4(src, dstSize) {
    const dst = new Uint8Array(dstSize);
    let ip = 0, op = 0;
    while (ip < src.length) {
      const t = src[ip++];
      let lit = t >> 4;
      if (lit === 15) { let s = 0; do { s = src[ip++]; lit += s; } while (s === 255); }
      dst.set(src.subarray(ip, ip + lit), op); ip += lit; op += lit;
      if (ip >= src.length) break;
      const off = src[ip] | (src[ip + 1] << 8); ip += 2;
      let ml = t & 15;
      if (ml === 15) { let s = 0; do { s = src[ip++]; ml += s; } while (s === 255); }
      ml += 4;
      for (let i = 0; i < ml; i++) { dst[op] = dst[op - off]; op++; }
    }
    return dst;
  }
  return {
    has(p) { return byPath.has(p); },
    entries() { return entries.map((e) => e.p); },
    read(p) {
      const e = byPath.get(p);
      if (!e) return null;
      const abs = dataStart + e.off;
      const seg = data.subarray(abs, abs + e.len);
      const orig = dv.getUint32(abs, true) + dv.getUint32(abs + 4, true) * 4294967296;
      if (orig <= e.len || orig > 2147483647) return Buffer.from(seg);
      let r = abs + 8;
      const out = new Uint8Array(orig);
      let written = 0;
      while (written < orig) {
        const u = dv.getInt32(r, true), c = dv.getInt32(r + 4, true);
        r += 8;
        out.set(lz4(data.subarray(r, r + c), u), written);
        r += c; written += u;
      }
      return Buffer.from(out);
    },
    readJson(p) { const b = this.read(p); return b ? JSON.parse(b.toString('utf8')) : null; },
    readText(p) { const b = this.read(p); return b ? b.toString('utf8') : null; },
  };
}

// ── TEX 解析/解码 (复用 pkg-extract 的成熟实现) ─────────────────────

// 完整 PNG 解码 (支持灰度/索引/RGB/RGBA + 所有滤波) → {width,height,rgba}
export function decodePngBuffer(b) {
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const bitDepth = b[24], colorType = b[25];
  // 颜色类型: 0=灰度 2=RGB 3=索引 4=灰度+alpha 6=RGBA
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 3 ? 1 : 0;
  if (w <= 0 || h <= 0 || w > 32768 || h > 32768 || !channels) throw new Error('不支持的 PNG: ' + w + 'x' + h + ' ct=' + colorType + ' bit=' + bitDepth);
  if (bitDepth !== 8 && !(bitDepth === 16 && (colorType === 0 || colorType === 2 || colorType === 6))) {
    // 8-bit 常规; 16-bit 灰度/RGB/RGBA 取高字节; 1/2/4-bit 灰度/索引需扩展
  }
  // 收集 IDAT
  const idats = [];
  let pos = 8;
  while (pos + 12 <= b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idats.push(b.subarray(pos + 8, pos + 8 + len));
    if (type === 'IEND') break;
    pos += 12 + len;
    if (pos > b.length) break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const bytesPerPx = channels * (bitDepth === 16 ? 2 : 1);
  const stride = w * bytesPerPx + 1;
  if (raw.length < stride * h) throw new Error('PNG 数据不足');
  // 调色板 (索引色)
  let palette = null;
  if (colorType === 3) {
    pos = 8;
    while (pos + 12 <= b.length) {
      const len = b.readUInt32BE(pos);
      const type = b.toString('ascii', pos + 4, pos + 8);
      if (type === 'PLTE') {
        const plte = b.subarray(pos + 8, pos + 8 + len);
        palette = [];
        for (let i = 0; i + 2 < plte.length; i += 3) palette.push([plte[i], plte[i+1], plte[i+2]]);
        break;
      }
      pos += 12 + len;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  let prevLine = new Uint8Array(w * bytesPerPx);
  const readPx = (line, x) => {
    const base = x * bytesPerPx;
    if (colorType === 6) return [line[base], line[base+1], line[base+2], line[base+3]];
    if (colorType === 2) return [line[base], line[base+1], line[base+2], 255];
    if (colorType === 0) return [line[base], line[base], line[base], 255];
    if (colorType === 4) return [line[base], line[base], line[base], line[base+1]];
    if (colorType === 3) {
      const idx = line[base];
      const c = palette && palette[idx];
      return c ? [c[0], c[1], c[2], 255] : [0, 0, 0, 255];
    }
    return [0, 0, 0, 255];
  };
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride];
    const line = raw.subarray(y * stride + 1, (y + 1) * stride);
    const cur = new Uint8Array(w * bytesPerPx);
    for (let x = 0; x < w * bytesPerPx; x++) {
      const a = x >= bytesPerPx ? cur[x - bytesPerPx] : 0;
      const pr = prevLine[x];
      const pc = x >= bytesPerPx ? prevLine[x - bytesPerPx] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + pr) & 255;
      else if (f === 3) v = (v + ((a + pr) >> 1)) & 255;
      else if (f === 4) {
        const pa = Math.abs(pr - pc), pb = Math.abs(a - pc), pcd = Math.abs(a + pr - 2 * pc);
        const p = pa <= pb && pa <= pcd ? a : pb <= pcd ? pr : pc;
        v = (v + p) & 255;
      }
      cur[x] = v;
    }
    for (let x = 0; x < w; x++) {
      const [r, g, b2, a2] = readPx(cur, x);
      const di = (y * w + x) * 4;
      rgba[di] = r; rgba[di+1] = g; rgba[di+2] = b2; rgba[di+3] = a2;
    }
    prevLine = cur;
  }
  return { width: w, height: h, rgba };
}

// 读取外部 PNG 文件为 {width,height,rgba} (用于粒子贴图映射)
export function loadPngFile(p) {
  return decodePngBuffer(fs.readFileSync(p));
}

export function loadTexImage(raw) {
  try {
    const info = parseTex(raw);
    const dec = decodeTex(raw);
    let width, height, rgba;
    if (dec.kind === 'png-pass') {
      // 内嵌 PNG → 解码为 rgba
      const img = decodePngBuffer(Buffer.from(dec.bytes));
      width = img.width; height = img.height; rgba = img.rgba;
    } else if (dec.kind === 'jpeg') {
      // 内嵌 JPEG → 无法纯 JS 解码, 回退 null (调用方用占位)
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
    return { width, height, rgba };
  } catch (e) {
    throw e;
  }
}

// ── 值解析工具 (scene.json 字符串形式) ─────────────────────────────
export function parseVec3(s, def = [0, 0, 0]) {
  if (s == null) return def;
  if (typeof s === 'number') return [s, s, s];
  if (Array.isArray(s)) return [s[0] ?? def[0], s[1] ?? def[1], s[2] ?? def[2]];
  const p = String(s).trim().split(/\s+/).map(Number);
  return [p[0] ?? def[0], p[1] ?? def[1], p[2] ?? def[2]];
}
export function parseVec2(s, def = [0, 0]) {
  if (s == null) return def;
  if (typeof s === 'number') return [s, s];
  if (Array.isArray(s)) return [s[0] ?? def[0], s[1] ?? def[1]];
  const p = String(s).trim().split(/\s+/).map(Number);
  return [p[0] ?? def[0], p[1] ?? def[1]];
}
export function getVal(o, key, def) {
  const v = o && o[key];
  if (v == null) return def;
  if (typeof v === 'object' && v !== null && 'value' in v) return v.value;
  return v;
}

// ── common_blending.h ApplyBlending 的 CPU 复刻 ──────────────────────
const _c3 = (x) => [x, x, x];
const _sat3 = (v) => [Math.min(1, Math.max(0, v[0])), Math.min(1, Math.max(0, v[1])), Math.min(1, Math.max(0, v[2]))];
function _rgbToHsl(c) {
  const r = c[0], g = c[1], b = c[2];
  const fmin = Math.min(r, g, b), fmax = Math.max(r, g, b);
  const delta = fmax - fmin;
  const hsl = [0, 0, (fmax + fmin) / 2];
  if (delta === 0) return hsl;
  hsl[1] = hsl[2] < 0.5 ? delta / (fmax + fmin) : delta / (2 - fmax - fmin);
  const deltaR = (((fmax - r) / 6) + delta / 2) / delta;
  const deltaG = (((fmax - g) / 6) + delta / 2) / delta;
  const deltaB = (((fmax - b) / 6) + delta / 2) / delta;
  if (r === fmax) hsl[0] = deltaB - deltaG;
  else if (g === fmax) hsl[0] = 1 / 3 + deltaR - deltaB;
  else hsl[0] = 2 / 3 + deltaG - deltaR;
  if (hsl[0] < 0) hsl[0] += 1; else if (hsl[0] > 1) hsl[0] -= 1;
  return hsl;
}
function _hueToRgb(f1, f2, hue) {
  let h = hue;
  if (h < 0) h += 1; else if (h > 1) h -= 1;
  if (6 * h < 1) return f1 + (f2 - f1) * 6 * h;
  if (2 * h < 1) return f2;
  if (3 * h < 2) return f1 + (f2 - f1) * ((2 / 3) - h) * 6;
  return f1;
}
function _hslToRgb(hsl) {
  if (hsl[1] === 0) return _c3(hsl[2]);
  const f2 = hsl[2] < 0.5 ? hsl[2] * (1 + hsl[1]) : (hsl[2] + hsl[1]) - (hsl[1] * hsl[2]);
  const f1 = 2 * hsl[2] - f2;
  return [_hueToRgb(f1, f2, hsl[0] + 1 / 3), _hueToRgb(f1, f2, hsl[0]), _hueToRgb(f1, f2, hsl[0] - 1 / 3)];
}
const _bDarken = (A, B) => [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.min(A[2], B[2])];
const _bLighten = (A, B) => [Math.max(A[0], B[0]), Math.max(A[1], B[1]), Math.max(A[2], B[2])];
const _bScreen = (A, B) => [1 - (1 - A[0]) * (1 - B[0]), 1 - (1 - A[1]) * (1 - B[1]), 1 - (1 - A[2]) * (1 - B[2])];
const _bOverlay = (A, B) => A.map((a, i) => (a < 0.5 ? 2 * a * B[i] : 1 - 2 * (1 - a) * (1 - B[i])));
const _bSoftLight = (A, B) => A.map((a, i) => { const b = B[i]; return b < 0.5 ? 2 * a * b + a * a * (1 - 2 * b) : Math.sqrt(a) * (2 * b - 1) + 2 * a * (1 - b); });
const _bColorDodge = (A, B) => A.map((a, i) => { const b = B[i]; return b === 1 ? b : Math.min(a / (1 - b), 1); });
const _bColorBurn = (A, B) => A.map((a, i) => { const b = B[i]; return b === 0 ? b : Math.max(1 - (1 - a) / b, 0); });
const _bVividLight = (A, B) => A.map((a, i) => { const b = B[i]; return b < 0.5 ? _bColorBurn([a], [2 * b])[0] : _bColorDodge([a], [2 * (b - 0.5)])[0]; });
const _bLinearLight = (A, B) => A.map((a, i) => { const b = B[i]; return b < 0.5 ? Math.max(a + 2 * b - 1, 0) : Math.min(a + 2 * (b - 0.5), 1); });
const _bPinLight = (A, B) => A.map((a, i) => { const b = B[i]; return b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * (b - 0.5)); });
const _bHardMix = (A, B) => _bVividLight(A, B).map((v) => (v < 0.5 ? 0 : 1));
const _bReflect = (A, B) => A.map((a, i) => { const b = B[i]; return b === 1 ? b : Math.min(a * a / (1 - b), 1); });
const _bPhoenix = (A, B) => A.map((a, i) => Math.min(a, B[i]) - Math.max(a, B[i]) + 1);
// ApplyBlending: A=base(原图), B=blend(效果层), opacity=混合强度
export function applyBlending(mode, A, B, opacity) {
  const mix = (a, b, o) => a.map((v, i) => v * (1 - o) + b[i] * o);
  switch (mode) {
    case 1: return mix(A, _bDarken(A, B), opacity);
    case 2: return mix(A, A.map((v, i) => v * B[i]), opacity);
    case 3: return mix(A, _bColorBurn(A, B), opacity);
    case 4: return mix(A, A.map((v, i) => Math.max(v + B[i] - 1, 0)), opacity);
    case 5: return _bDarken(A, B);
    case 6: return mix(A, _bLighten(A, B), opacity);
    case 7: return mix(A, _bScreen(A, B), opacity);
    case 8: return mix(A, _bColorDodge(A, B), opacity);
    case 9: return mix(A, A.map((v, i) => Math.min(v + B[i], 1)), opacity);
    case 10: return _bLighten(A, B);
    case 11: return mix(A, _bOverlay(A, B), opacity);
    case 12: return mix(A, _bSoftLight(A, B), opacity);
    case 13: return mix(A, _bOverlay(B, A), opacity);
    case 14: return mix(A, _bVividLight(A, B), opacity);
    case 15: return mix(A, _bLinearLight(A, B), opacity);
    case 16: return mix(A, _bPinLight(A, B), opacity);
    case 17: return mix(A, _bHardMix(A, B), opacity);
    case 18: return mix(A, A.map((v, i) => Math.abs(v - B[i])), opacity);
    case 19: return mix(A, A.map((v, i) => v + B[i] - 2 * v * B[i]), opacity);
    case 20: return mix(A, A.map((v, i) => Math.max(v + B[i] - 1, 0)), opacity);
    case 21: return mix(A, _bReflect(A, B), opacity);
    case 22: return mix(A, _bReflect(B, A), opacity);
    case 23: return mix(A, _bPhoenix(A, B), opacity);
    case 24: return mix(A, A.map((v, i) => (v + B[i]) / 2), opacity);
    case 25: return mix(A, A.map((v, i) => 1 - Math.abs(1 - v - B[i])), opacity);
    case 26: { const bs = _rgbToHsl(B), as = _rgbToHsl(A); return mix(A, _hslToRgb([bs[0], as[1], as[2]]), opacity); }
    case 27: { const bs = _rgbToHsl(B), as = _rgbToHsl(A); return mix(A, _hslToRgb([as[0], bs[1], as[2]]), opacity); }
    case 28: { const bs = _rgbToHsl(B), as = _rgbToHsl(A); return mix(A, _hslToRgb([bs[0], bs[1], as[2]]), opacity); }
    case 29: { const bs = _rgbToHsl(B), as = _rgbToHsl(A); return mix(A, _hslToRgb([as[0], as[1], bs[2]]), opacity); }
    case 30: { const t = Math.max(A[0], Math.max(A[1], A[2])); return mix(A, _c3(t).map((v, i) => v * B[i]), opacity); }
    case 31: return A.map((v, i) => v + B[i] * opacity);
    case 32: return mix(A, A.map((v, i) => v + v * B[i]), opacity);
    default: return mix(A, B, opacity);
  }
}
function _greyscale(c) { return c[0] * 0.11 + c[1] * 0.59 + c[2] * 0.3; }
function _frac(x) { return x - Math.floor(x); }

// ── mat4 / vec3 工具 (列主序, gl-matrix 约定: v' = M * v) ─────────────
const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3norm = (a) => { const l = Math.sqrt(v3dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function mat4Identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mat4Mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function mat4Ortho(l, r, b, t, near, far) {
  const w = r - l, h = t - b, d = far - near;
  return [2 / w, 0, 0, 0, 0, 2 / h, 0, 0, 0, 0, -2 / d, 0, -(r + l) / w, -(t + b) / h, -(far + near) / d, 1];
}
function mat4LookAt(eye, center, up) {
  const z = v3norm(v3sub(eye, center));
  const x = v3norm(v3cross(up, z));
  const y = v3cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3dot(x, eye), -v3dot(y, eye), -v3dot(z, eye), 1];
}
function mat4FromTRS(t, r, s) {
  // 引擎事实 (lwe-CParticle.cpp:1836): m = T * Rz(-z) * Ry(y) * Rx(-x) * S
  // X/Z 角取负 (Y-flip 坐标系); 列主序
  const rx = -r[0], ry = r[1], rz = -r[2];
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // Rx (绕 X 旋转, 列主序)
  const mx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  // Ry
  const my = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  // Rz
  const mz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // 顶点先 Rx 再 Ry 再 Rz: R = Rz * Ry * Rx (列主序矩阵乘法顺序)
  const rot = mat4Mul(mat4Mul(mz, my), mx);
  const m = mat4Identity();
  m[0] = rot[0] * s[0]; m[1] = rot[1] * s[0]; m[2] = rot[2] * s[0];
  m[4] = rot[4] * s[1]; m[5] = rot[5] * s[1]; m[6] = rot[6] * s[1];
  m[8] = rot[8] * s[2]; m[9] = rot[9] * s[2]; m[10] = rot[10] * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}
function mat4TransformPoint(m, p) {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  const iw = w !== 0 ? 1 / w : 0;
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) * iw,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) * iw,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) * iw,
    w,
  ];
}
function mat4TransformVec3(m, v) {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
}
const sat = (x) => Math.max(0, Math.min(1, x));

// ── 画布 (RGBA 缓冲 + 合成操作) ────────────────────────────────────
export class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.data = new Uint8Array(w * h * 4); this.zbuf = new Float32Array(w * h); this.zbuf.fill(Infinity); }
  clear(r = 0, g = 0, b = 0, a = 0) { this.data.fill(0); this.zbuf.fill(Infinity); }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i+1], this.data[i+2], this.data[i+3]];
  }
  set(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r; this.data[i+1] = g; this.data[i+2] = b; this.data[i+3] = a;
  }
  // source-over 合成一个已解码纹理 (直接像素拷贝, 无缩放)
  blit(img, dx, dy, alpha = 1) {
    const x0 = Math.floor(dx), y0 = Math.floor(dy);
    for (let ty = y0; ty < y0 + img.height; ty++) {
      if (ty < 0 || ty >= this.h) continue;
      for (let tx = x0; tx < x0 + img.width; tx++) {
        if (tx < 0 || tx >= this.w) continue;
        const sx = tx - x0, sy = ty - y0;
        const si = (sy * img.width + sx) * 4;
        const a = img.rgba[si + 3] / 255 * alpha;
        if (a <= 0) continue;
        const di = (ty * this.w + tx) * 4;
        const dstA = this.data[di + 3] / 255;
        const outA = a + dstA * (1 - a);
        this.data[di] = Math.round((img.rgba[si] * a + this.data[di] * dstA * (1 - a)) / outA);
        this.data[di+1] = Math.round((img.rgba[si+1] * a + this.data[di+1] * dstA * (1 - a)) / outA);
        this.data[di+2] = Math.round((img.rgba[si+2] * a + this.data[di+2] * dstA * (1 - a)) / outA);
        this.data[di+3] = Math.round(outA * 255);
      }
    }
  }
  // 带缩放的 blit (bilinear, 从全尺寸图缩放绘制)
  blitScaled(img, dx, dy, dw, dh, alpha = 1) {
    const x0 = Math.floor(dx), y0 = Math.floor(dy);
    const x1 = Math.ceil(dx + dw), y1 = Math.ceil(dy + dh);
    const invDw = img.width / dw, invDh = img.height / dh;
    // 源图偏移: dx 小数部分映射到源图起始
    const srcOffX = (x0 - dx) * invDw, srcOffY = (y0 - dy) * invDh;
    for (let ty = y0; ty < y1; ty++) {
      if (ty < 0 || ty >= this.h) continue;
      const sy = Math.min(img.height - 1, Math.max(0, Math.round(srcOffY + (ty - y0) * invDh)));
      const rowBase = sy * img.width;
      for (let tx = x0; tx < x1; tx++) {
        if (tx < 0 || tx >= this.w) continue;
        const sx = Math.min(img.width - 1, Math.max(0, Math.round(srcOffX + (tx - x0) * invDw)));
        const si = (rowBase + sx) * 4;
        const a = img.rgba[si + 3] / 255 * alpha;
        if (a <= 0) continue;
        const di = (ty * this.w + tx) * 4;
        const dstA = this.data[di + 3] / 255;
        const outA = a + dstA * (1 - a);
        this.data[di] = Math.round((img.rgba[si] * a + this.data[di] * dstA * (1 - a)) / outA);
        this.data[di+1] = Math.round((img.rgba[si+1] * a + this.data[di+1] * dstA * (1 - a)) / outA);
        this.data[di+2] = Math.round((img.rgba[si+2] * a + this.data[di+2] * dstA * (1 - a)) / outA);
        this.data[di+3] = Math.round(outA * 255);
      }
    }
  }
}

export function encodePng(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(b) {
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  let crc = 0xffffffff;
  for (let i = 0; i < b.length; i++) crc = t[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}


export class SceneRenderer {
  /**
   * @param {string} pkgPath scene.pkg 路径
   * @param {object} opts { width, height, time, log }
   */
  constructor(pkgPath, opts = {}) {
    this.pkgPath = pkgPath;
    // 支持: scene.pkg 文件 / 松散 scene.json 目录 / scene.json 文件路径
    let isDir = false;
    try { isDir = fs.statSync(pkgPath).isDirectory(); } catch { /* */ }
    if (!isDir && String(pkgPath).toLowerCase().endsWith('.json')) {
      // scene.json 文件 → 用其所在目录
      pkgPath = path.dirname(pkgPath);
      isDir = true;
    }
    this.pkg = isDir ? readPkgDir(pkgPath) : readPkg(pkgPath);
    this.log = opts.log || (() => {});
    this.scene = this.pkg.readJson('scene.json');
    if (!this.scene) throw new Error('scene.json 不存在');
    this.W = opts.width || 3840;
    this.H = opts.height || 2160;
    this.fovOverride = opts.fov != null ? opts.fov : null;
    this.time = opts.time ?? 0;
    this.canvas = new Canvas(this.W, this.H);
    this.textureCache = new Map();
    this.particleCache = new Map();
    // 缺失纹理 → 外部 PNG 贴图映射 (已从 pkg 提取的粒子贴图)
    this.assetDir = opts.assetDir || null;
    // WE 全局 assets 目录 (util/noise 等全局纹理)
    this.weAssetsDir = opts.weAssetsDir || null;
    // 视差鼠标位置 (0-1, 默认中心)
    this.optsMouse = opts.mouse || null;
    this._resolveObjects();
  }

  // 读 JSON: 场景 pkg 优先, 缺失时回退 WE 全局 assets (assets/models/..., assets/materials/...)
  readJsonAny(rel) {
    if (!rel) return null;
    let j = this.pkg.readJson(rel);
    if (j || !this.weAssetsDir) return j;
    const gp = path.join(this.weAssetsDir, 'assets', rel);
    try {
      if (fs.existsSync(gp)) return JSON.parse(fs.readFileSync(gp, 'utf8'));
    } catch { /* ignore */ }
    return null;
  }

  // 读原始字节: 场景 pkg 优先, 缺失时回退 WE 全局 assets
  readAny(rel) {
    if (!rel) return null;
    let b = this.pkg.read(rel);
    if (b || !this.weAssetsDir) return b;
    const gp = path.join(this.weAssetsDir, 'assets', rel);
    try {
      if (fs.existsSync(gp)) return new Uint8Array(fs.readFileSync(gp));
    } catch { /* ignore */ }
    return null;
  }

  // ── 对象树: 依赖/父级排序 (CScene::createObject/addObjectToRenderOrder) ──
  _resolveObjects() {
    const objects = this.scene.objects || [];
    this.objects = objects.map((o) => ({ ...o, _renderType: this._classify(o) }));
    // 渲染顺序: 依赖前置 + 场景顺序
    const order = [];
    const added = new Set();
    const add = (o) => {
      if (added.has(o.id)) return;
      for (const dep of o.dependencies || []) {
        const d = this.objects.find((x) => x.id === dep);
        if (d) add(d);
      }
      if (o.parent != null) {
        const p = this.objects.find((x) => x.id === o.parent);
        if (p) add(p);
      }
      added.add(o.id);
      order.push(o);
    };
    for (const o of this.objects) add(o);
    this.renderOrder = order;
  }

  _classify(o) {
    if (o.image) return 'image';
    if (o.model) return 'model';
    if (o.particle) return 'particle';
    if (o.sound) return 'sound';
    if (o.text) return 'text';
    if (o.light) return 'light';
    return 'unknown';
  }

  // 纹理加载: pkg .tex 优先, 缺失时用 WE 全局 assets, 最后外部 PNG 贴图映射
  loadTexture(pathOrName) {
    if (!pathOrName) return null;
    let texPath = pathOrName;
    if (!texPath.endsWith('.tex')) texPath = 'materials/' + texPath + '.tex';
    if (this.textureCache.has(texPath)) return this.textureCache.get(texPath);
    let raw = this.pkg.read(texPath);
    let img = null;
    if (raw) {
      try {
        img = loadTexImage(raw);
      } catch (e) {
        this.log('纹理解析失败 ' + texPath + ': ' + e.message);
      }
    }
    // WE 全局 assets 回退: assets/materials/util/noise.tex
    if (!img && this.weAssetsDir) {
      const globalPath = path.join(this.weAssetsDir, 'assets', texPath);
      try {
        if (fs.existsSync(globalPath)) {
          const gRaw = fs.readFileSync(globalPath);
          img = loadTexImage(gRaw);
        }
      } catch (e) {
        this.log('全局纹理解析失败 ' + globalPath + ': ' + e.message);
      }
    }
    if (!img && this.assetDir) {
      img = this._loadAssetPng(texPath);
    }
    this.textureCache.set(texPath, img);
    return img;
  }

  // 从外部目录加载粒子贴图 (按纹理名匹配)
  _loadAssetPng(texPath) {
    if (!this.assetDir) return null;
    const name = texPath.split('/').pop().replace('.tex', '');
    const map = {
      'flare_1': 'particle_flare1.png',
      'halo_6': 'particle_halo6.png',
      'halo_9': 'particle_halo6.png',
      'halo_2': 'particle_halo6.png',
      'Untitled': 'particle_leaves.png',
      '图层 44': 'particle_layer44.png',
      '图层 39': 'particle_layer39.png',
      'debris1': 'particle_debris1.png',
    };
    const f = map[name];
    if (!f) return null;
    const p = this.assetDir + '/' + f;
    try { return loadPngFile(p); } catch (e) { return null; }
  }

  // 加载模型 → 材质 → 主纹理
  loadModelTexture(modelPath) {
    const model = this.pkg.readJson(modelPath);
    if (!model) return null;
    const mat = model.material ? this.pkg.readJson(model.material) : null;
    if (!mat || !mat.passes || !mat.passes.length) return null;
    const texName = mat.passes[0].textures && mat.passes[0].textures[0];
    return texName ? this.loadTexture(texName) : null;
  }

  // ── 变换解析 (CImage::resolveTransform: 父链 origin/scale/angle 累积) ──
  resolveTransform(o) {
    const origin = parseVec3(getVal(o, 'origin'), [0, 0, 0]);
    const scale = parseVec3(getVal(o, 'scale'), [1, 1, 1]);
    const angles = parseVec3(getVal(o, 'angles'), [0, 0, 0]);
    // 父链
    let res = { origin, scale, angle: angles[2], angles };
    let cur = o;
    let guard = 0;
    while (cur.parent != null && guard < 32) {
      const parent = this.objects.find((x) => x.id === cur.parent);
      if (!parent) break;
      const pOrigin = parseVec3(getVal(parent, 'origin'), [0, 0, 0]);
      const pScale = parseVec3(getVal(parent, 'scale'), [1, 1, 1]);
      const pAngles = parseVec3(getVal(parent, 'angles'), [0, 0, 0]);
      // 子 origin 经父 scale 缩放后叠加, 角度累积 (父 Z 角旋转子 origin)
      const cos = Math.cos(pAngles[2]), sin = Math.sin(pAngles[2]);
      const rx = res.origin[0] * res.scale[0], ry = res.origin[1] * res.scale[1];
      const ox = rx * cos - ry * sin;
      const oy = rx * sin + ry * cos;
      res = {
        origin: [pOrigin[0] + ox, pOrigin[1] + oy, 0],
        scale: [res.scale[0] * pScale[0], res.scale[1] * pScale[1], 1],
        angle: res.angle + pAngles[2],
        angles: [res.angles[0] + pAngles[0], res.angles[1] + pAngles[1], res.angles[2] + pAngles[2]],
      };
      cur = parent;
      guard++;
    }
    return res;
  }

  // ── 主渲染入口 ────────────────────────────────────────────────────
  render() {
    const t = this.time;
    this.canvas.clear();
    this._setupCamera();
    // scene scripts: 执行 {script, value} 更新 (彩虹色/visible/bloom 等动态值)
    try {
      applySceneScripts(this.scene, t);
    } catch { /* 脚本失败不影响渲染 */ }
    // clearColor
    const cc = this.scene.general && this.scene.general.clearcolor;
    if (cc && this.scene.general.clearenabled !== false) {
      const [r, g, b] = parseVec3(cc, [0, 0, 0]);
      this.canvas.clear(r * 255, g * 255, b * 255, 255);
    }
    const order = this.renderOrder.filter((o) => getVal(o, 'visible', true) !== false);
    for (const o of order) {
      try {
        if (o._renderType === 'image') this.renderImage(o, t);
        else if (o._renderType === 'model') this.renderModel(o, t);
        else if (o._renderType === 'particle') this.renderParticleSystem(o, t);
        else if (o._renderType === 'text') this.renderTextObject(o, t);
      } catch (e) {
        this.log('对象 ' + (o.name || o.id) + ' 渲染失败: ' + e.message);
      }
    }
    // Bloom 后处理 (WE 场景标配: 亮部提取 → 降采样模糊 → 叠加)
    const gen = this.scene.general || {};
    if (gen.bloom === true) {
      this._applyBloom(gen);
    }
    return this.canvas;
  }

  // Bloom: 引擎完整链 (downsample_quarter_bloom → combine_hdr)
  // 1. 降采样 1/4: 4 角平均 → saturate(scale-threshold) → 饱和度增强 → ×strength×tint
  // 2. 合成: 原图 + bloom 4 角平均×0.25 → 线性化 lin() → ×曝光
  _applyBloom(gen) {
    const W = this.W, H = this.H;
    const data = this.canvas.data;
    const getNum = (v, d) => {
      if (v == null) return d;
      if (typeof v === 'object' && v !== null && 'value' in v) return typeof v.value === 'number' ? v.value : d;
      return typeof v === 'number' ? v : d;
    };
    const threshold = getNum(gen.bloomthreshold, 0.65);
    const strength = getNum(gen.bloomstrength, 1);
    const tint = parseVec3(getVal(gen, 'bloomtint', '1 1 1'), [1, 1, 1]);
    // HDR 参数
    const hdrThreshold = getNum(gen.bloomhdrthreshold, threshold);
    const hdrStrength = getNum(gen.bloomhdrstrength, strength);
    const hdrScatter = getNum(gen.bloomhdrscatter, 1);
    const hdrFeather = getNum(gen.bloomhdrfeather, 0);
    // 曝光 (combine_hdr g_RenderVar0.x) — 近似 1
    const exposure = 1;
    // 降采样 1/4: 4 角平均 (downsample_quarter_bloom)
    const sw = Math.max(8, Math.floor(W / 4)), sh = Math.max(8, Math.floor(H / 4));
    const bright = new Float32Array(sw * sh * 3);
    const lin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        // 源区域 4 角 (映射到全分辨率)
        const x0 = Math.floor(x * W / sw), x1 = Math.min(W - 1, x0 + Math.floor(W / sw));
        const y0 = Math.floor(y * H / sh), y1 = Math.min(H - 1, y0 + Math.floor(H / sh));
        let r = 0, g = 0, b = 0;
        for (const [sx, sy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
          const i = (sy * W + sx) * 4;
          r += data[i] / 255; g += data[i + 1] / 255; b += data[i + 2] / 255;
        }
        r *= 0.25; g *= 0.25; b *= 0.25;
        // saturate(scale - threshold) — 引擎: albedo *= saturate(scale - threshold)
        const scale = Math.max(r, g, b);
        const k = Math.max(0, Math.min(1, scale - threshold));
        r *= k; g *= k; b *= k;
        // 饱和度增强 (引擎: -gray*sat + albedo*(1+sat), sat=1)
        const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
        r = -gray + r * 2; g = -gray + g * 2; b = -gray + b * 2;
        // × strength × tint
        const o = (y * sw + x) * 3;
        bright[o] = Math.max(0, r * strength * tint[0]);
        bright[o + 1] = Math.max(0, g * strength * tint[1]);
        bright[o + 2] = Math.max(0, b * strength * tint[2]);
      }
    }
    // HDR 通道: 更高阈值 + 强度 (单独降采样)
    const hdr = new Float32Array(sw * sh * 3);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const x0 = Math.floor(x * W / sw), x1 = Math.min(W - 1, x0 + Math.floor(W / sw));
        const y0 = Math.floor(y * H / sh), y1 = Math.min(H - 1, y0 + Math.floor(H / sh));
        let r = 0, g = 0, b = 0;
        for (const [sx, sy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
          const i = (sy * W + sx) * 4;
          r += data[i] / 255; g += data[i + 1] / 255; b += data[i + 2] / 255;
        }
        r *= 0.25; g *= 0.25; b *= 0.25;
        const scale = Math.max(r, g, b);
        // 软阈值 (hdrfeather): smoothstep 过渡
        const k = Math.max(0, Math.min(1, (scale - hdrThreshold) / Math.max(0.001, hdrFeather)));
        const o = (y * sw + x) * 3;
        hdr[o] = Math.max(0, r * k * hdrStrength * tint[0]);
        hdr[o + 1] = Math.max(0, g * k * hdrStrength * tint[1]);
        hdr[o + 2] = Math.max(0, b * k * hdrStrength * tint[2]);
      }
    }
    // 散射: 多次模糊 (hdrScatter 控制扩散) — combine_hdr upsample 的 ×0.25×scatter 等价
    const passes = Math.max(1, Math.round(2 * hdrScatter));
    let blur = bright, blurHdr = hdr;
    for (let p = 0; p < passes; p++) {
      const r1 = Math.max(1, Math.round(1.5 * hdrScatter));
      blur = this._blurQuarter(blur, sw, sh, r1);
      blurHdr = this._blurQuarter(blurHdr, sw, sh, r1);
    }
    // 合成: 引擎 combine (LDR: albedo+bloom; HDR: lin(albedo)+bloom)
    const isHdr = getVal(gen, 'hdr', false) === true;
    const eff = 0.25 * Math.max(1, hdrScatter);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(sh - 1, Math.floor(y * sh / H));
      for (let x = 0; x < W; x++) {
        const sx = Math.min(sw - 1, Math.floor(x * sw / W));
        const o = (sy * sw + sx) * 3;
        const i = (y * W + x) * 4;
        const br = (blur[o] + blurHdr[o]) * eff;
        const bg = (blur[o + 1] + blurHdr[o + 1]) * eff;
        const bb = (blur[o + 2] + blurHdr[o + 2]) * eff;
        if (isHdr) {
          // HDR: lin(albedo) + bloom → 曝光 (引擎 combine_hdr)
          const r = lin(data[i] / 255) + br;
          const g2 = lin(data[i + 1] / 255) + bg;
          const b2 = lin(data[i + 2] / 255) + bb;
          data[i] = Math.min(255, Math.round(sat(r) * exposure * 255));
          data[i + 1] = Math.min(255, Math.round(sat(g2) * exposure * 255));
          data[i + 2] = Math.min(255, Math.round(sat(b2) * exposure * 255));
        } else {
          // LDR: albedo + bloom (引擎 combine.frag)
          data[i] = Math.min(255, data[i] + Math.round(br * 255));
          data[i + 1] = Math.min(255, data[i + 1] + Math.round(bg * 255));
          data[i + 2] = Math.min(255, data[i + 2] + Math.round(bb * 255));
        }
      }
    }
  }

  // 1/4 分辨率盒式模糊 (bloom 散射)
  _blurQuarter(src, sw, sh, r) {
    const out = new Float32Array(sw * sh * 3);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let rSum = 0, gSum = 0, bSum = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.min(sh - 1, Math.max(0, y + dy));
          for (let dx = -r; dx <= r; dx++) {
            const xx = Math.min(sw - 1, Math.max(0, x + dx));
            const o = (yy * sw + xx) * 3;
            rSum += src[o]; gSum += src[o + 1]; bSum += src[o + 2]; n++;
          }
        }
        const o = (y * sw + x) * 3;
        out[o] = rSum / n; out[o + 1] = gSum / n; out[o + 2] = bSum / n;
      }
    }
    return out;
  }

  // ── 相机 / 光照环境 (scene.json camera + general) ──────────────────
  // camera paths: 多 path 顺序循环 (总时长 = duration 和), path 内关键帧线性插值
  _resolveCameraPose(cam, t) {
    const def = {
      eye: parseVec3(cam.eye, [0, 0, 1]),
      center: parseVec3(cam.center, [0, 0, 0]),
      up: parseVec3(cam.up, [0, 1, 0]),
      zoom: 1,
    };
    // 读取 paths: 每 path 的 transforms (timestamp 升序)
    let paths = [];
    try {
      if (Array.isArray(cam.paths)) {
        for (const p of cam.paths) {
          if (typeof p === 'string') {
            const j = this.pkg.readJson(p);
            if (j && Array.isArray(j.paths)) paths = paths.concat(j.paths);
          } else if (p && Array.isArray(p.paths)) {
            paths = paths.concat(p.paths);
          } else if (p && Array.isArray(p.transforms)) {
            paths.push(p);
          }
        }
      }
    } catch { /* paths 解析失败 → 用默认相机 */ }
    // 多 path 顺序循环: 每个 path 有效时长 = max(末帧 timestamp, duration)
    const eff = paths.map((p) => {
      const trs = (p.transforms || []).filter((x) => x && x.timestamp != null).sort((a, b) => a.timestamp - b.timestamp);
      const lastT = trs.length ? trs[trs.length - 1].timestamp : 0;
      return { p, trs, len: Math.max(lastT, p.duration != null ? p.duration : lastT) };
    });
    const total = eff.reduce((s, e) => s + e.len, 0);
    if (!eff.length || total <= 0) return def;
    // 全局时间定位 path
    let remain = ((t % total) + total) % total;
    let idx = 0;
    for (let i = 0; i < eff.length; i++) {
      if (remain < eff[i].len) { idx = i; break; }
      remain -= eff[i].len;
    }
    const cur = eff[idx];
    if (!cur.trs.length) return def;
    // path 内时间 → 关键帧插值 (clamp 到末帧)
    const pt = Math.min(remain, cur.trs[cur.trs.length - 1].timestamp);
    const pose = { ...def };
    let k = 0;
    while (k < cur.trs.length - 1 && pt > cur.trs[k + 1].timestamp) k++;
    const a = cur.trs[k], b = cur.trs[Math.min(k + 1, cur.trs.length - 1)];
    const span = b.timestamp - a.timestamp;
    const f = span > 0 ? Math.min(1, Math.max(0, (pt - a.timestamp) / span)) : 0;
    const lerp3 = (va, vb) => [va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f, va[2] + (vb[2] - va[2]) * f];
    pose.eye = lerp3(parseVec3(a.eye, def.eye), parseVec3(b.eye, def.eye));
    pose.center = lerp3(parseVec3(a.center, def.center), parseVec3(b.center, def.center));
    pose.up = v3norm(lerp3(parseVec3(a.up, def.up), parseVec3(b.up, def.up)));
    const za = a.zoom != null ? a.zoom : def.zoom, zb = b.zoom != null ? b.zoom : def.zoom;
    pose.zoom = za + (zb - za) * f;
    return pose;
  }

  _setupCamera() {
    const cam = this.scene.camera || {};
    const gen = this.scene.general || {};
    // camera paths: 多镜头顺序循环, 全局时间定位当前 path + 关键帧插值
    const camPose = this._resolveCameraPose(cam, this.time);
    const eye = camPose.eye;
    const center = camPose.center;
    const up = camPose.up;
    this.camEye = eye;
    this.camView = mat4LookAt(eye, center, up);
    const near = gen.nearz != null ? gen.nearz : 0.01;
    const far = gen.farz != null ? gen.farz : 10000;
    const ortho = gen.orthogonalprojection;
    if (ortho && ortho.width) {
      const hw = ortho.width / 2;
      const hh = (ortho.height || 1080) / 2;
      // 正交: 场景坐标直接映射画布 (shimmering 等 2D 场景)
      this.camProj = mat4Ortho(-hw, hw, -hh, hh, near, far);
      this.camIsOrtho = true;
    } else {
      // opts.fov 覆盖 (诊断用); 默认取场景 fov, 缺失时 50
      const fovDeg = this.fovOverride != null ? this.fovOverride : (gen.fov != null ? gen.fov : 50);
      const zoom = camPose.zoom != null ? camPose.zoom : (gen.zoom != null ? gen.zoom : 1);
      let fovy = fovDeg * Math.PI / 180;
      this.camProj = mat4Perspective(fovy, this.W / this.H, near, far);
      if (zoom !== 1) { // zoom 缩放视野
        this.camProj[0] *= zoom; this.camProj[5] *= zoom;
      }
      this.camIsOrtho = false;
    }
    this.camVP = mat4Mul(this.camProj, this.camView); // Clip = Proj · View · World · p
    // 视差 (lwe-CScene.cpp:304): displacement = mix(disp, centeredMouse*amount*influence, delay)
    // 静态帧默认鼠标中心 (0.5,0.5) → 无位移; opts.mouse 可驱动 (跨平台能力)
    this.parallaxDisp = [0, 0];
    const par = cam.parallax || {};
    const parEnabled = getVal(par, 'enabled', false) === true;
    if (parEnabled) {
      const parAmount = getVal(par, 'amount', 1);
      const parInfluence = getVal(par, 'mouseinfluence', 0.1);
      const mx = this.optsMouse != null ? this.optsMouse[0] : 0.5;
      const my = this.optsMouse != null ? this.optsMouse[1] : 0.5;
      const centeredMouse = [mx - 0.5, my - 0.5];
      this.parallaxDisp = [centeredMouse[0] * parAmount * parInfluence, centeredMouse[1] * parAmount * parInfluence];
    }
    // 光照
    this.lights = (this.scene.objects || []).filter((o) => o.light).map((o) => ({
      type: String(o.light || 'point').toLowerCase(),
      origin: parseVec3(o.origin, [0, 0, 0]),
      color: parseVec3(o.color, [1, 1, 1]),
      intensity: o.intensity != null ? o.intensity : 1,
      radius: o.radius != null ? o.radius : 10,
    }));
    this.ambientColor = parseVec3(gen.ambientcolor, [0.3, 0.3, 0.3]);
    this.skylightColor = parseVec3(gen.skylightcolor, [0.3, 0.3, 0.3]);
    // 用户属性 (project.json general.properties 默认值, 供 material usershadervalues 映射)
    this.userProps = {};
    try {
      const proj = this.pkg.readJson('project.json');
      const props = proj && proj.general && proj.general.properties;
      if (props) for (const [k, v] of Object.entries(props)) {
        if (v && typeof v === 'object' && 'value' in v) this.userProps[k] = v.value;
      }
    } catch { /* 无 project.json */ }
  }

  // 已实现 CPU 移植的 shader 集合 (model/image 材质分发用)
  get _customShaders() {
    return new Set(['core', 'backgroundsphere', 'dna', 'bg', 'curve', 'neonsun', 'neongrid', 'cloudsbg', 'flowimage']);
  }

  // 全屏 quad (clip 空间 -1..1, uv 0..1) 渲染自定义程序化 shader
  _renderFullscreenShader(o, mat, pass, shaderName, t) {
    const uniforms = this._materialUniforms(mat, pass);
    const textures = (pass && pass.textures || []).map((p) => this.loadTexture(p));
    const tex = textures[0] || null;
    const tex1 = textures[1] || null;
    const tex2 = textures[2] || null;
    const tex3 = textures[3] || null;
    const W = this.W, H = this.H;
    const positions = [[-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 1, 0]];
    const uvs = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const indices = [0, 2, 1, 2, 3, 1]; // CCW (屏幕空间)
    const n = 4;
    const vp = new Float64Array(n * 6);
    const shadeData = new Float64Array(n * 8);
    for (let i = 0; i < n; i++) {
      const sx = (positions[i][0] * 0.5 + 0.5) * W;
      const sy = (0.5 - positions[i][1] * 0.5) * H;
      vp[i * 6] = sx; vp[i * 6 + 1] = sy; vp[i * 6 + 2] = 1; vp[i * 6 + 3] = 0.5;
      vp[i * 6 + 4] = uvs[i][0]; vp[i * 6 + 5] = uvs[i][1];
      shadeData[i * 8 + 2] = 1; // 法线 +z
    }
    const vs = { shaderName, uniforms, tex, tex1, tex2, tex3, textures, textureNames: (pass && pass.textures) || [], t, combos: (pass && pass.combos) || {} };
    const blending = pass && pass.blending ? pass.blending : 'opaque';
    const depthWrite = !(pass && pass.depthwrite === 'disabled');
    this._rasterizeMesh3D(indices, vp, shadeData, vs, blending, depthWrite);
  }

  // 材质 uniforms: usershadervalues (如 schemecolor→tint) 解析
  _materialUniforms(mat, pass) {
    const out = {};
    const usv = pass && pass.usershadervalues;
    if (usv) for (const [prop, uniform] of Object.entries(usv)) {
      const v = this.userProps[prop];
      if (v != null) {
        if (typeof v === 'string' && v.trim().split(/\s+/).length > 1) out[uniform] = parseVec3(v, [1, 1, 1]);
        else out[uniform] = typeof v === 'number' ? v : parseFloat(v);
      }
    }
    const csv = pass && pass.constantshadervalues;
    if (csv) for (const [k, v] of Object.entries(csv)) out[k] = v;
    return out;
  }

  // ── Image 对象渲染 ────────────────────────────────────────────────
  renderImage(o, t) {
    const model = this.readJsonAny(o.image);
    if (!model) return;
    const tr = this.resolveTransform(o);
    // puppet 模型 → MDL 网格渲染
    if (model.puppet) {
      this.renderPuppet(o, model, tr, t);
      return;
    }
    // 自定义 shader 材质 (cloudsbg 等程序化全屏效果) → 全屏 quad 走 3D 光栅化
    const mat = model.material ? this.readJsonAny(model.material) : null;
    const pass = mat && mat.passes && mat.passes[0] ? mat.passes[0] : null;
    const shaderName = pass ? pass.shader : '';
    if (shaderName && this._customShaders.has(shaderName)) {
      this._renderFullscreenShader(o, mat, pass, shaderName, t);
      return;
    }
    // passthrough 后处理层 (fullscreenlayer 等): 纹理是 _rt_ 渲染目标 → 读取当前画布内容
    const passthrough = model.passthrough === true
      || (pass && pass.textures && pass.textures[0] && String(pass.textures[0]).startsWith('_rt_'));
    if (passthrough) {
      this._renderPassthroughLayer(o, model, pass, t);
      return;
    }
    const tex = this.loadModelTexture(o.image);
    if (!tex) { this.log('跳过 image ' + (o.name || o.id) + ': 无纹理'); return; }
    // 尺寸: scene size 或纹理尺寸
    let size = parseVec2(getVal(o, 'size'), [0, 0]);
    if ((size[0] === 0 || size[1] === 0) && tex) size = [tex.width, tex.height];
    // model fullscreen → 全屏
    if (model.fullscreen) { size = [this.W, this.H]; }
    const alpha = getVal(o, 'alpha', 1);
    const brightness = getVal(o, 'brightness', 1);
    // 正交投影缩放: 场景单位(ortho width/height) → 画布像素
    const ortho = this.scene.general && this.scene.general.orthogonalprojection;
    const ps = ortho && ortho.width ? [this.W / ortho.width, this.H / (ortho.height || 1080)] : null;
    const ox = ps ? tr.origin[0] * ps[0] : tr.origin[0];
    const oy = ps ? tr.origin[1] * ps[1] : tr.origin[1];
    const sc = tr.scale;
    // CImage 坐标: 像素左上角 = (origin.x - dw/2, H - origin.y - dh/2), y 向下
    const dw = size[0] * sc[0] * (ps ? ps[0] : 1), dh = size[1] * sc[1] * (ps ? ps[1] : 1);
    const dx = ox - dw / 2, dy = this.H - oy - dh / 2;
    // 效果链: 先应用 shader 效果到纹理副本 (CPU), 再绘制
    let img = tex;
    if (o.effects && o.effects.length) {
      img = this.applyEffects(o, tex, t);
    }
    if (img && tr.angle !== 0) {
      // 旋转: 简化实现 — 用 canvas 层面旋转 (此处先按 0 处理, 有角度对象单独处理)
      this.log('对象 ' + (o.name || o.id) + ' 有角度 ' + tr.angle.toFixed(3) + ' (旋转暂未支持, 直接绘制)');
    }
    // 视差: (depth + amount) * displacement * referenceSize (lwe-CImage.cpp:1111)
    let pdx = 0, pdy = 0;
    if (this.parallaxDisp[0] !== 0 || this.parallaxDisp[1] !== 0) {
      const pd = parseVec2(getVal(o, 'parallaxDepth', '1 1'), [1, 1]);
      const parAmount = getVal((this.scene.camera || {}).parallax, 'amount', 1);
      const ref = this.W;
      pdx = (pd[0] + parAmount) * this.parallaxDisp[0] * ref;
      pdy = (pd[1] + parAmount) * this.parallaxDisp[1] * ref;
    }
    if (img) this.canvas.blitScaled(img, dx + pdx, dy + pdy, dw, dh, alpha * brightness);
  }

    // passthrough 后处理层: 输入 = 当前画布内容 (_rt_ framebuffer), 应用效果链后全屏合成
  _renderPassthroughLayer(o, model, pass, t) {
    const W = this.W, H = this.H;
    const frame = new Uint8Array(this.canvas.data);
    const tex = { width: W, height: H, rgba: frame };
    let img = tex;
    if (o.effects && o.effects.length) {
      img = this.applyEffects(o, tex, t);
    }
    if (!img) return;
    // 材质 blending: fullscreenlayer = translucent → alpha 合成
    const alpha = getVal(o, 'alpha', 1);
    const blending = pass && pass.blending ? pass.blending : 'translucent';
    if (blending === 'opaque') {
      for (let i = 0; i < this.canvas.data.length; i++) this.canvas.data[i] = img.rgba[i];
    } else {
      this.canvas.blit(img, 0, 0, alpha);
    }
  }

  // ── Text 对象渲染: CFF 字体解析 + 位图光栅化 → 画布 blit ───────
  renderTextObject(o, t) {
    const text = String(getVal(o, 'text', ''));
    if (!text) return;
    const color = parseVec3(getVal(o, 'color', '1 1 1'), [1, 1, 1]);
    const pointsize = getVal(o, 'pointsize', 32);
    const scale = parseVec3(getVal(o, 'scale'), [1, 1, 1]);
    const tr = this.resolveTransform(o);
    const ortho = this.scene.general && this.scene.general.orthogonalprojection;
    const ps = ortho && ortho.width ? [this.W / ortho.width, this.H / (ortho.height || 1080)] : [1, 1];
    // 字体: 场景 fonts/ 或全局 assets/fonts/
    let fontPath = getVal(o, 'font', '');
    if (fontPath) {
      try {
        const raw = this.readAny(fontPath) || this.readAny('fonts/' + path.basename(fontPath));
        if (!raw) { this.log('text ' + (o.name || o.id) + ': 字体缺失 ' + fontPath); return; }
        const font = parseCffFont(raw);
        if (!font) { this.log('text ' + (o.name || o.id) + ': 字体解析失败'); return; }
        // WE text: 字形像素 = pointsize × 场景缩放 × 对象 scale (场景单位→像素)
        const px = Math.max(4, Math.round(pointsize * ps[1] * scale[1]));
        const img = renderText(font, text, px, color);
        if (!img.width) return;
        // 定位: origin 是场景坐标 (y 向上), horizontalalign right 时右对齐
        const ox = tr.origin[0] * ps[0], oy = this.H - tr.origin[1] * ps[1];
        const dw = img.width, dh = img.height;
        const align = String(getVal(o, 'horizontalalign', 'left'));
        const dx = align === 'right' ? ox - dw : (align === 'center' ? ox - dw / 2 : ox - dw / 2);
        this.canvas.blitScaled(img, dx, oy - dh / 2, dw, dh, getVal(o, 'alpha', 1));
      } catch (e) {
        this.log('text ' + (o.name || o.id) + ' 渲染失败: ' + e.message);
      }
    }
  }

  // ── Puppet (MDL 网格) 渲染: 解析 mesh → 蒙皮(绑定姿态) → 光栅化 ────
  renderPuppet(o, model, tr, t) {
    const mdlRaw = this.pkg.read(model.puppet);
    if (!mdlRaw) { this.log('跳过 puppet ' + (o.name || o.id) + ': 无 MDL'); return; }
    const mesh = this._parseMdl(mdlRaw);
    if (!mesh) { this.log('跳过 puppet ' + (o.name || o.id) + ': MDL 解析失败'); return; }
    const tex = this.loadModelTexture(o.image);
    if (!tex) { this.log('跳过 puppet ' + (o.name || o.id) + ': 无纹理'); return; }
    // cropoffset: 模型网格的 scene 坐标偏移 (y 向上为正, 直接叠加到网格顶点)
    const crop = (model.cropoffset || '0 0').trim().split(/\s+/).map(Number);
    const cxs = crop[0] || 0, cys = crop[1] || 0;
    const shifted = mesh.positions.map((p) => [p[0] + cxs, p[1] + cys, p[2]]);
    // mesh 顶点已是场景坐标 (y 向上): 画布内 x' = x - minX, y' = maxY - y (flipY)
    const rawBounds = this._meshBounds(shifted);
    const W = Math.ceil(rawBounds.maxX - rawBounds.minX) + 1;
    const H = Math.ceil(rawBounds.maxY - rawBounds.minY) + 1;
    const flipY = (y) => rawBounds.maxY - y;
    const img = this._rasterizeMesh(mesh, tex, shifted, rawBounds, W, H, flipY);
    // 定位: drawOffset = (minX, -maxY), 画布左上角像素 = origin + drawOffset (已验证)
    const dw = W * tr.scale[0], dh = H * tr.scale[1];
    const dx = tr.origin[0] + rawBounds.minX, dy = (this.H - tr.origin[1]) - rawBounds.maxY;
    this.canvas.blitScaled(img, dx, dy, dw, dh, getVal(o, 'alpha', 1));
  }

  _parseMdl(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let mdlsOffset = buf.length;
    for (let off = 9; off + 4 < buf.length; off++) {
      if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
    }
    let found = null;
    for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
      const vertexBytes = dv.getUint32(offset + 4, true);
      const verticesOffset = offset + 8;
      if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
      const indexLenOffset = verticesOffset + vertexBytes;
      if (indexLenOffset + 4 > mdlsOffset) continue;
      const indexBytes = dv.getUint32(indexLenOffset, true);
      const indicesOffset = indexLenOffset + 4;
      if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
      found = { verticesOffset, vertexBytes, indicesOffset, indexBytes };
      break;
    }
    if (!found) return null;
    const vertexCount = found.vertexBytes / 80;
    const indexCount = found.indexBytes / 2;
    const positions = [], uvs = [];
    for (let i = 0; i < vertexCount; i++) {
      const vo = found.verticesOffset + i * 80;
      positions.push([dv.getFloat32(vo, true), dv.getFloat32(vo + 4, true), dv.getFloat32(vo + 8, true)]);
      uvs.push([dv.getFloat32(vo + 72, true), dv.getFloat32(vo + 76, true)]);
    }
    const indices = [];
    for (let i = 0; i < indexCount; i++) indices.push(dv.getUint16(found.indicesOffset + i * 2, true));
    return { positions, uvs, indices, vertexCount, indexCount };
  }

  // ── 静态 MDL (MDLV0014 非 puppet 变体) 解析 ────────────────────────
  // 结构: "MDLV0014" + 头部 + "materials/....json\0" + u32 标志 + u32 顶点字节数
  //       + 顶点流 (stride 32: pos/normal/uv; stride 64: pos/normal/tangent/uv)
  //       + u32 索引字节数 + u16 索引流
  _parseMdlStatic(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // MDLV0004 / MDLV0014 等版本均适用 (布局相同, 仅版本号不同)
    if (buf.length < 16 || buf.toString('ascii', 0, 4) !== 'MDLV') return null;
    const matStart = this._indexOfBytes(buf, 'materials/', 8);
    if (matStart < 0) return null;
    let matEnd = matStart;
    while (matEnd < buf.length && buf[matEnd] !== 0) matEnd++;
    const materialPath = buf.toString('utf8', matStart, matEnd);
    const f0 = dv.getUint32(matEnd + 1, true);
    const vertBytes = dv.getUint32(matEnd + 5, true);
    const vertStart = matEnd + 9;
    if (vertBytes <= 0 || vertBytes > buf.length || vertStart + vertBytes > buf.length) return null;
    // stride 探测: 优先 64/32 (pos+normal+uv); 无法线布局 (如 bgfade: pos+uv, stride 20) 走宽松回退
    const cands = [];
    for (const stride of [64, 48, 32, 40, 44, 56]) {
      if (vertBytes % stride !== 0) continue;
      const vc = vertBytes / stride;
      if (vc < 3 || vc > 100000) continue;
      let normOk = 0, n = 0;
      for (let i = 0; i < Math.min(vc, 300); i++) {
        const o = vertStart + i * stride;
        const nx = dv.getFloat32(o + 12, true), ny = dv.getFloat32(o + 16, true), nz = dv.getFloat32(o + 20, true);
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (Math.abs(l - 1) < 0.1) normOk++;
        n++;
      }
      if (normOk < n * 0.6) continue;
      // 索引范围检查
      const idxBytesPos = vertStart + vertBytes;
      const idxBytesT = dv.getUint32(idxBytesPos, true);
      const idxStartT = idxBytesPos + 4;
      let idxAllOk = false;
      if (idxBytesT > 0 && idxBytesT % 2 === 0 && idxStartT + idxBytesT <= buf.length + 1) {
        const ic = idxBytesT / 2;
        if (ic > 0 && ic % 3 === 0 && ic < 300000) {
          let ok = 0;
          for (let k = 0; k < Math.min(ic, 400); k++) {
            if (dv.getUint16(idxStartT + k * 2, true) < vc) ok++;
          }
          idxAllOk = ok > Math.min(ic, 400) * 0.98;
        }
      }
      // 法线-面法线对齐 (平滑网格判别)
      let align = 0, an = 0;
      if (idxAllOk) {
        for (let k = 0; k + 2 < Math.min(idxBytesT / 2, 3000); k += 3) {
          const a = dv.getUint16(idxStartT + k * 2, true), b = dv.getUint16(idxStartT + k * 2 + 2, true), c = dv.getUint16(idxStartT + k * 2 + 4, true);
          if (a >= vc || b >= vc || c >= vc) continue;
          const pa = [dv.getFloat32(vertStart + a * stride, true), dv.getFloat32(vertStart + a * stride + 4, true), dv.getFloat32(vertStart + a * stride + 8, true)];
          const pb = [dv.getFloat32(vertStart + b * stride, true), dv.getFloat32(vertStart + b * stride + 4, true), dv.getFloat32(vertStart + b * stride + 8, true)];
          const pc = [dv.getFloat32(vertStart + c * stride, true), dv.getFloat32(vertStart + c * stride + 4, true), dv.getFloat32(vertStart + c * stride + 8, true)];
          const e1 = v3sub(pb, pa), e2 = v3sub(pc, pa);
          const fn = v3norm(v3cross(e1, e2));
          const vn = [dv.getFloat32(vertStart + a * stride + 12, true), dv.getFloat32(vertStart + a * stride + 16, true), dv.getFloat32(vertStart + a * stride + 20, true)];
          const vl = Math.sqrt(v3dot(vn, vn)) || 1;
          align += Math.abs(v3dot(fn, [vn[0] / vl, vn[1] / vl, vn[2] / vl]));
          an++;
        }
        if (an > 0) align /= an;
      }
      cands.push({ stride, vc, idxAllOk, align });
    }
    cands.sort((a, b) => (b.idxAllOk - a.idxAllOk) || (b.align - a.align));
    let chosen = cands[0];
    // 无法线回退: pos+uv 布局 (stride 20 等), 用位置界 + 索引范围 + UV 覆盖率判别
    if (!chosen) {
      const idxBytesPos = vertStart + vertBytes;
      const idxBytesT = dv.getUint32(idxBytesPos, true);
      const idxStartT = idxBytesPos + 4;
      let ic = 0;
      if (idxBytesT > 0 && idxBytesT % 2 === 0 && idxStartT + idxBytesT <= buf.length + 1) ic = idxBytesT / 2;
      for (const stride of [20, 16, 24, 28, 36, 40, 44, 48, 56]) {
        if (vertBytes % stride !== 0) continue;
        const vc = vertBytes / stride;
        if (vc < 3 || vc > 100000) continue;
        if (ic === 0 || ic % 3 !== 0) continue;
        let idxOk = 0;
        for (let k = 0; k < Math.min(ic, 400); k++) if (dv.getUint16(idxStartT + k * 2, true) < vc) idxOk++;
        if (idxOk < Math.min(ic, 400) * 0.98) continue;
        // UV 覆盖率 (uv 在 stride 末尾)
        const uvOff = stride - 8;
        let uvOk = 0, uvN = 0;
        let minX = 1e9, maxX = -1e9;
        for (let i = 0; i < Math.min(vc, 300); i++) {
          const o = vertStart + i * stride;
          const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
          if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(x) > 10000 || Math.abs(y) > 10000) continue;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          const u = dv.getFloat32(o + uvOff, true), v = dv.getFloat32(o + uvOff + 4, true);
          if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) uvOk++;
          uvN++;
        }
        if (uvN > 0 && uvOk > uvN * 0.6) { chosen = { stride, vc, hasNormals: false }; break; }
      }
    }
    if (!chosen) return null;
    const { stride, vc, hasNormals } = chosen;
    const positions = [], normals = [], uvs = [], uv2s = [];
    const hasN = hasNormals !== false;
    // UV 布局 (引擎 vertex): 主纹理 UV1 在 stride 末尾 (stride-8);
    // 第 2 UV (lightmap) 仅 stride 56 有 (pos12+normal12+uv2 8+uv1 8+tangent16 → uv2@stride-16)
    const uvOff = stride === 64 ? 36 : stride - 8;
    let uv2Off = -1;
    if (stride === 56) {
      const p = stride - 16;
      let ok = 0, n = 0;
      for (let i = 0; i < Math.min(vc, 150); i++) {
        const o = vertStart + i * stride;
        const u = dv.getFloat32(o + p, true), v = dv.getFloat32(o + p + 4, true);
        if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) ok++;
        n++;
      }
      if (ok / n > 0.7) uv2Off = p;
    }
    for (let i = 0; i < vc; i++) {
      const o = vertStart + i * stride;
      positions.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]);
      normals.push(hasN ? [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true)] : null);
      uvs.push([dv.getFloat32(o + uvOff, true), dv.getFloat32(o + uvOff + 4, true)]);
      uv2s.push(uv2Off >= 0 ? [dv.getFloat32(o + uv2Off, true), dv.getFloat32(o + uv2Off + 4, true)] : null);
    }
    const idxBytesPos = vertStart + vertBytes;
    const idxBytes = dv.getUint32(idxBytesPos, true);
    const idxStart = idxBytesPos + 4;
    if (idxBytes <= 0 || idxBytes % 2 !== 0 || idxStart + idxBytes > buf.length + 1) return null;
    const indices = [];
    for (let i = 0; i < idxBytes / 2; i++) indices.push(dv.getUint16(idxStart + i * 2, true));
    return { positions, normals, uvs, uv2s, indices, materialPath, stride, vertexCount: vc, indexCount: indices.length };
  }

  _indexOfBytes(buf, str, from) {
    const needle = Buffer.from(str, 'ascii');
    for (let i = from; i + needle.length <= buf.length; i++) {
      let ok = true;
      for (let k = 0; k < needle.length; k++) if (buf[i + k] !== needle[k]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }

  // ── Model 对象渲染: MDL 静态网格 + 相机 + 光照 + CPU shader ────────
  renderModel(o, t) {
    const mdlRaw = this.pkg.read(o.model);
    if (!mdlRaw) { this.log('跳过 model ' + (o.name || o.id) + ': 无 MDL'); return; }
    const mesh = this._parseMdlStatic(mdlRaw);
    if (!mesh) { this.log('跳过 model ' + (o.name || o.id) + ': MDL 解析失败'); return; }
    // 材质
    const mat = mesh.materialPath ? this.pkg.readJson(mesh.materialPath) : null;
    const pass = mat && mat.passes && mat.passes[0] ? mat.passes[0] : null;
    const shaderName = pass ? pass.shader : 'generic3';
    const uniforms = this._materialUniforms(mat, pass);
    const tex = pass && pass.textures && pass.textures.length ? this.loadTexture(pass.textures[0]) : null;
    const tex1 = pass && pass.textures[1] ? this.loadTexture(pass.textures[1]) : null;
    const tex2 = pass && pass.textures[2] ? this.loadTexture(pass.textures[2]) : null;
    const tex3 = pass && pass.textures[3] ? this.loadTexture(pass.textures[3]) : null;
    // 对象变换 → 世界
    const tr = this.resolveTransform(o);
    const worldM = mat4FromTRS(tr.origin, tr.angles || [tr.angleX || 0, tr.angleY || 0, tr.angleZ ?? tr.angle ?? 0], tr.scale);
    // 顶点变换 + 逐顶点着色
    const { positions, normals, uvs, uv2s, indices } = mesh;
    const n = positions.length;
    const vp = new Float64Array(n * 6); // x,y,w(ndc), depth(ndc.z), u, v
    const shadeData = new Float64Array(n * 8); // normal(r,g,b), lightScale, worldX, worldY, uv2(u,v)
    const vs = { shaderName, uniforms, tex, tex1, tex2, tex3, textures: (pass && pass.textures || []).map((p) => this.loadTexture(p)), textureNames: (pass && pass.textures) || [], t, combos: (pass && pass.combos) || {} };
    // 无法线网格: 用位移后顶点重算平滑法线 (neongrid 等)
    let meshNormals = normals;
    const displaced = new Array(n);
    if (!normals[0]) {
      meshNormals = new Array(n).fill(null).map(() => [0, 0, 0]);
      for (let i = 0; i < n; i++) {
        let local = positions[i];
        if (shaderName === 'core') local = this._coreVertex(local, uvs[i], t);
        else if (shaderName === 'dna') local = this._dnaVertex(local, t);
        else if (shaderName === 'neongrid') local = this._neonGridVertex(local, uvs[i], t, uniforms.mountainscale ?? 1);
        displaced[i] = local;
      }
      for (let k = 0; k + 2 < indices.length; k += 3) {
        const a = indices[k], b = indices[k + 1], c = indices[k + 2];
        const pa = displaced[a], pb = displaced[b], pc = displaced[c];
        const e1 = v3sub(pb, pa), e2 = v3sub(pc, pa);
        const fn = v3cross(e1, e2);
        meshNormals[a][0] += fn[0]; meshNormals[a][1] += fn[1]; meshNormals[a][2] += fn[2];
        meshNormals[b][0] += fn[0]; meshNormals[b][1] += fn[1]; meshNormals[b][2] += fn[2];
        meshNormals[c][0] += fn[0]; meshNormals[c][1] += fn[1]; meshNormals[c][2] += fn[2];
      }
      for (let i = 0; i < n; i++) meshNormals[i] = v3norm(meshNormals[i]);
    }
    for (let i = 0; i < n; i++) {
      let local = positions[i];
      if (shaderName === 'core') local = this._coreVertex(local, uvs[i], t);
      else if (shaderName === 'dna') local = this._dnaVertex(local, t);
      else if (shaderName === 'neongrid') local = this._neonGridVertex(local, uvs[i], t, uniforms.mountainscale ?? 1);
      let clip;
      if (shaderName === 'bg') {
        // bg.vert: gl_Position = vec4(uv*2-1, 0.5, 1) — 由 UV 生成, 忽略模型/相机
        clip = [uvs[i][0] * 2 - 1, uvs[i][1] * 2 - 1, 0.5, 1];
      } else if (shaderName === 'cloudsbg') {
        // cloudsbg.vert: gl_Position = vec4(a_Position, 1.0) — 网格位置即 clip 坐标
        clip = [local[0], local[1], 0.5, 1];
      } else {
        const wp = mat4TransformPoint(worldM, local);
        clip = mat4TransformPoint(this.camVP, wp); // 已做透视除法: [ndcX, ndcY, ndcZ, w]
        shadeData[i * 8 + 3] = wp[0]; shadeData[i * 8 + 4] = wp[1]; shadeData[i * 8 + 5] = wp[2];
      }
      const sx = (clip[0] * 0.5 + 0.5) * this.W;
      const sy = (0.5 - clip[1] * 0.5) * this.H;
      vp[i * 6] = sx; vp[i * 6 + 1] = sy; vp[i * 6 + 2] = clip[3]; vp[i * 6 + 3] = clip[2];
      vp[i * 6 + 4] = uvs[i][0]; vp[i * 6 + 5] = uvs[i][1];
      const srcN = meshNormals[i];
      const wn = srcN ? v3norm(mat4TransformVec3(worldM, srcN)) : [0, 0, 1];
      shadeData[i * 8] = wn[0]; shadeData[i * 8 + 1] = wn[1]; shadeData[i * 8 + 2] = wn[2];
      // 第 2 UV 通道 (lightmap) — 透视校正插值
      if (uv2s && uv2s[i]) {
        shadeData[i * 8 + 6] = uv2s[i][0]; shadeData[i * 8 + 7] = uv2s[i][1];
      }
    }
    // 光栅化 (z-buffer + 透视校正插值 + 每像素 shader)
    const blending = pass ? (pass.blending || 'opaque') : 'opaque';
    const depthWrite = !(pass && pass.depthwrite === 'disabled');
    this._rasterizeMesh3D(indices, vp, shadeData, vs, blending, depthWrite);
  }

  // core.vert 顶点位移 (audio=0, g_Time=t): localPos += localPos * step(0,uv.x) * anims.y * 0.5
  _coreVertex(local, uv, t) {
    const period = Math.PI * 4;
    const a = t * 0.4, cs = Math.cos(a), sn = Math.sin(a);
    const rx = cs * uv[0] - sn * uv[1], ry = sn * uv[0] + cs * uv[1];
    const animsY = sat(Math.sin((rx + ry) * period + t));
    const stepX = uv[0] >= 0 ? 1 : 0;
    return [local[0] + local[0] * stepX * animsY * 0.5, local[1] + local[1] * stepX * animsY * 0.5, local[2] + local[2] * stepX * animsY * 0.5];
  }

  // dna.vert: y 偏移 + xz 旋转 (螺旋动画)
  _dnaVertex(local, t) {
    const timeOffset = (t * 0.1) % 1;
    const y = local[1] + timeOffset * 0.5;
    const rot = timeOffset * Math.PI;
    const c = Math.cos(rot), s = Math.sin(rot);
    return [local[0] * c - local[2] * s, y, local[0] * s + local[2] * c];
  }

  // neongrid.vert: fbm 山体位移 (完全照搬 shader 数学)
  _neonGridVertex(local, uv, t, mountainScale) {
    const fract = (x) => x - Math.floor(x);
    const rand = (n0, n1) => {
      const d = n0 * 12.9898 + n1 * 4.1414;
      return fract(Math.sin(d) * 43758.5453);
    };
    const noise2 = (px, py) => {
      const ipx = Math.floor(px), ipy = Math.floor(py);
      let ux = px - ipx, uy = py - ipy;
      ux = ux * ux * (3 - 2 * ux);
      uy = uy * uy * (3 - 2 * uy);
      const a = rand(ipx, ipy) + (rand(ipx + 1, ipy) - rand(ipx, ipy)) * ux;
      const b = rand(ipx, ipy + 1) + (rand(ipx + 1, ipy + 1) - rand(ipx, ipy + 1)) * ux;
      const res = a + (b - a) * uy;
      return res * res;
    };
    const fbm = (x0, y0) => {
      let v = 0, a = 0.5, px = x0, py = y0;
      const c = Math.cos(0.5), s = Math.sin(0.5);
      for (let i = 0; i < 5; i++) {
        v += a * noise2(px, py);
        const nx = (c * px - s * py) * 2 + 100;
        const ny = (s * px + c * py) * 2 + 100;
        px = nx; py = ny;
        a *= 0.5;
      }
      return v;
    };
    const speed = t * 2;
    const gridPosX = Math.floor(uv[0] * 50);
    const gridPosY = Math.floor(uv[1] * 50 + speed);
    const dampenDistance = Math.abs(uv[0] * 2 - 1);
    const fallOffSides = Math.pow(1.05 - dampenDistance, 0.5);
    const fallOffCenter = 0.2 + 0.8 * Math.pow(dampenDistance, 2);
    const speedFrac = fract(speed) / 50;
    const dampenY = uv[1] - speedFrac;
    const clipCenter = sat(0.8 - dampenDistance);
    const ms = mountainScale != null ? mountainScale : 1;
    let offsetY = Math.max(0, fbm(gridPosX * 0.1, gridPosY * 0.1) * 2 - clipCenter) * fallOffCenter * ms;
    offsetY = offsetY * fallOffSides * dampenY + Math.pow(dampenDistance, 2) * 0.02;
    return [local[0], local[1] + offsetY, local[2] - speedFrac * 2];
  }

  // ── 3D 光栅化: 透视校正 UV/法线/世界坐标 + z-buffer + 每像素 CPU shader ──
  _rasterizeMesh3D(indices, vp, sd, vs, blending, depthWrite = true) {
    const W = this.W, H = this.H;
    const canvas = this.canvas;
    const zbuf = canvas.zbuf;
    const shade = this._makeShadeFn(vs);
    for (let tIdx = 0; tIdx + 2 < indices.length; tIdx += 3) {
      // vp 每顶点 6 值, sd 每顶点 8 值 — 分开索引
      const vi0 = indices[tIdx] * 6, vi1 = indices[tIdx + 1] * 6, vi2 = indices[tIdx + 2] * 6;
      const i0 = indices[tIdx] * 8, i1 = indices[tIdx + 1] * 8, i2 = indices[tIdx + 2] * 8;
      const x0 = vp[vi0], y0 = vp[vi0 + 1], w0 = vp[vi0 + 2], d0 = vp[vi0 + 3], u0 = vp[vi0 + 4], v0 = vp[vi0 + 5];
      const x1 = vp[vi1], y1 = vp[vi1 + 1], w1 = vp[vi1 + 2], d1 = vp[vi1 + 3], u1 = vp[vi1 + 4], v1 = vp[vi1 + 5];
      const x2 = vp[vi2], y2 = vp[vi2 + 1], w2 = vp[vi2 + 2], d2 = vp[vi2 + 3], u2 = vp[vi2 + 4], v2 = vp[vi2 + 5];
      // 双面渲染: 不按绕序剔除 (不同模型文件绕序约定不一致, 且引擎对无 cullmode
      // 材质默认不剔除); 背面三角的法线翻转以保证光照方向正确 (two-sided lighting)
      const e1x = x1 - x0, e1y = y1 - y0, e2x = x2 - x0, e2y = y2 - y0;
      const cross = e1x * e2y - e1y * e2x;
      if (Math.abs(cross) < 1e-9) continue;
      const backface = cross < 0;
      const bx0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const bx1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const by0 = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const by1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (bx1 < bx0 || by1 < by0) continue;
      // 顶点着色属性 (法线/世界坐标) 用于透视校正插值
      for (let py = by0; py <= by1; py++) {
        for (let px = bx0; px <= bx1; px++) {
          const pxc = px + 0.5, pyc = py + 0.5;
          const la = ((x1 - pxc) * (y2 - pyc) - (y1 - pyc) * (x2 - pxc)) / cross;
          const lb = ((x2 - pxc) * (y0 - pyc) - (y2 - pyc) * (x0 - pxc)) / cross;
          const lc = ((x0 - pxc) * (y1 - pyc) - (y0 - pyc) * (x1 - pxc)) / cross;
          if (la < -1e-4 || lb < -1e-4 || lc < -1e-4) continue;
          // 透视校正: 插值 1/w, u/w, v/w
          const iw0 = 1 / w0, iw1 = 1 / w1, iw2 = 1 / w2;
          const iw = la * iw0 + lb * iw1 + lc * iw2;
          const u = (la * u0 * iw0 + lb * u1 * iw1 + lc * u2 * iw2) / iw;
          const v = (la * v0 * iw0 + lb * v1 * iw1 + lc * v2 * iw2) / iw;
          const depth = la * d0 + lb * d1 + lc * d2;
          const di = py * W + px;
          if (depth >= zbuf[di]) continue;
          // 插值法线/世界坐标
          let nx = la * sd[i0] + lb * sd[i1] + lc * sd[i2];
          let ny = la * sd[i0 + 1] + lb * sd[i1 + 1] + lc * sd[i2 + 1];
          let nz = la * sd[i0 + 2] + lb * sd[i1 + 2] + lc * sd[i2 + 2];
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          if (backface) { nx = -nx; ny = -ny; nz = -nz; }
          const wx = la * sd[i0 + 3] + lb * sd[i1 + 3] + lc * sd[i2 + 3];
          const wy = la * sd[i0 + 4] + lb * sd[i1 + 4] + lc * sd[i2 + 4];
          const wz = la * sd[i0 + 5] + lb * sd[i1 + 5] + lc * sd[i2 + 5];
          // 第 2 UV (lightmap): 透视校正插值 (若 mesh 无 uv2, sd 为 0 → 用 uv1 兜底)
          const lmU0 = sd[i0 + 6] || 0, lmV0 = sd[i0 + 7] || 0;
          const lmU1 = sd[i1 + 6] || 0, lmV1 = sd[i1 + 7] || 0;
          const lmU2 = sd[i2 + 6] || 0, lmV2 = sd[i2 + 7] || 0;
          const hasUv2 = lmU0 !== 0 || lmU1 !== 0 || lmU2 !== 0 || lmV0 !== 0 || lmV1 !== 0 || lmV2 !== 0;
          const lmU = hasUv2 ? (la * lmU0 * iw0 + lb * lmU1 * iw1 + lc * lmU2 * iw2) / iw : u;
          const lmV = hasUv2 ? (la * lmV0 * iw0 + lb * lmV1 * iw1 + lc * lmV2 * iw2) / iw : v;
          const col = shade(u, v, [wx, wy, wz], [nx, ny, nz], this.camEye, lmU, lmV);
          if (!col || col[3] <= 0.003) continue;
          const di4 = di * 4;
          if (blending === 'opaque') {
            if (depthWrite) zbuf[di] = depth;
            canvas.data[di4] = Math.round(col[0] * 255);
            canvas.data[di4 + 1] = Math.round(col[1] * 255);
            canvas.data[di4 + 2] = Math.round(col[2] * 255);
            canvas.data[di4 + 3] = 255;
          } else if (blending === 'additive') {
            // additive: dst += src*srcA (D3D SRC_ALPHA / ONE), 不覆盖已有颜色
            if (depthWrite) zbuf[di] = depth;
            const sa = Math.min(1, col[3]);
            canvas.data[di4] = Math.min(255, canvas.data[di4] + Math.round(col[0] * 255 * sa));
            canvas.data[di4 + 1] = Math.min(255, canvas.data[di4 + 1] + Math.round(col[1] * 255 * sa));
            canvas.data[di4 + 2] = Math.min(255, canvas.data[di4 + 2] + Math.round(col[2] * 255 * sa));
            canvas.data[di4 + 3] = Math.max(canvas.data[di4 + 3], 255);
          } else {
            const a = Math.min(1, col[3]);
            const dstA = canvas.data[di4 + 3] / 255;
            const outA = a + dstA * (1 - a);
            if (outA <= 0) continue;
            if (depthWrite) zbuf[di] = depth;
            canvas.data[di4] = Math.round((col[0] * 255 * a + canvas.data[di4] * dstA * (1 - a)) / outA);
            canvas.data[di4 + 1] = Math.round((col[1] * 255 * a + canvas.data[di4 + 1] * dstA * (1 - a)) / outA);
            canvas.data[di4 + 2] = Math.round((col[2] * 255 * a + canvas.data[di4 + 2] * dstA * (1 - a)) / outA);
            canvas.data[di4 + 3] = Math.round(outA * 255);
          }
        }
      }
    }
  }

  // CPU shader 分派: 返回 (u, v, worldPos, normal, eye) => [r,g,b,a]
  _makeShadeFn(vs) {
    const { shaderName, uniforms, tex, tex1, tex2, t } = vs;
    if (shaderName === 'core') return (u, v, wp, n, eye) => this._shadeCore(u, v, wp, n, eye, uniforms, t);
    if (shaderName === 'backgroundsphere') return (u, v, wp, n, eye) => this._shadeBgSphere(u, v, uniforms, tex, tex1, tex2, t);
    if (shaderName === 'dna') return (u, v, wp, n, eye) => this._shadeDna(u, v, wp, n, eye, uniforms, tex, t);
    if (shaderName === 'bg') return (u, v, wp, n, eye) => this._shadeBg(u, v, uniforms, tex, tex1, t, vs.combos);
    if (shaderName === 'curve') return (u, v, wp, n, eye) => this._shadeCurve(u, v, uniforms, tex, t);
    if (shaderName === 'neonsun') return (u, v, wp, n, eye) => this._shadeNeonSun(u, v, uniforms, t);
    if (shaderName === 'neongrid') return (u, v, wp, n, eye) => this._shadeNeonGrid(u, v, wp, n, uniforms, t);
    if (shaderName === 'cloudsbg') return (u, v, wp, n, eye) => this._shadeCloudsBg(u, v, uniforms, tex1, t);
    if (shaderName === 'flowimage') return (u, v, wp, n, eye) => this._shadeFlowImage(u, v, uniforms, vs.textures, vs.textureNames, t);
    return (u, v, wp, n, eye, u2, v2) => this._shadeGeneric(u, v, wp, n, eye, uniforms, vs.textures, t, vs.combos, u2, v2);
  }

  // flowimage.frag (beach 项目源码): flowmask RG 方向 → 双相位循环偏移 → mix 两帧
  // deep_space 变体: textures = [flowmask, galaxy_layer_2, layer_1, layer_0], 多层各自速度
  _shadeFlowImage(u, v, uniforms, textures, texNames, t) {
    const bright = uniforms.Bright != null ? uniforms.Bright : 1;
    const amp = uniforms.Amount != null ? uniforms.Amount : 1;
    const power = uniforms.Power != null ? uniforms.Power : 1;
    const alpha = uniforms.Alpha != null ? uniforms.Alpha : 1;
    // flowmask 位置判断: 纹理名含 flowmask 的是方向图
    const names = texNames || [];
    const flowIdx = names.findIndex((n) => n && n.toLowerCase().includes('flowmask'));
    const flowTex = flowIdx >= 0 ? textures[flowIdx] : (textures[1] || textures[0]);
    const layers = textures.filter((t, i) => t && i !== flowIdx && i !== (flowIdx === 0 ? -1 : 0));
    if (!flowTex) return [0, 0, 0, 0];
    const f = this._texSample(flowTex, u, v);
    const maskX = (f[0] - 0.506) * 2, maskY = (f[1] - 0.482) * 2;
    const sampleFlow = (tex, speed) => {
      const cyc1 = ((t * speed) % 1 + 1) % 1, cyc2 = (((t * speed + 0.5) % 1) + 1) % 1;
      const blend = 2 * Math.abs(cyc1 - 0.5);
      const o1x = maskX * amp * 0.1 * cyc1, o1y = maskY * amp * 0.1 * cyc1;
      const o2x = maskX * amp * 0.1 * cyc2, o2y = maskY * amp * 0.1 * cyc2;
      const s1 = this._texSample(tex, u + o1x, v + o1y);
      const s2 = this._texSample(tex, u + o2x, v + o2y);
      return [
        s1[0] + (s2[0] - s1[0]) * blend,
        s1[1] + (s2[1] - s1[1]) * blend,
        s1[2] + (s2[2] - s1[2]) * blend,
      ];
    };
    let r, g, b;
    if (layers.length) {
      // 多层: 各自速度 (deep_space: Speed0/1/2; beach 单层用 Speed)
      const speeds = [uniforms.Speed0, uniforms.Speed1, uniforms.Speed2, uniforms.Speed];
      r = 0; g = 0; b = 0;
      for (let i = 0; i < layers.length; i++) {
        const sp = speeds[i] != null ? speeds[i] : 0.01;
        const c = sampleFlow(layers[i], sp);
        const w = Math.pow(0.5 + 0.5 * Math.min(1, Math.abs(maskX) + Math.abs(maskY)), power);
        r += c[0] * w; g += c[1] * w; b += c[2] * w;
      }
      const inv = 1 / layers.length;
      r *= inv; g *= inv; b *= inv;
    } else {
      r = 0; g = 0; b = 0;
    }
    return [sat(r * bright), sat(g * bright), sat(b * bright), alpha];
  }

  // dna.frag: albedo = tint * tex; rimlight = 1 - dot(V,N); albedo *= 1 + rimlight
  _shadeDna(u, v, wp, n, eye, uniforms, tex, t) {
    const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [0.5, 0.5, 0.5];
    let texRgb = [1, 1, 1];
    if (tex) {
      const x = ((u % 1) + 1) % 1, y = ((v % 1) + 1) % 1;
      const sx = Math.min(tex.width - 1, Math.max(0, Math.floor(x * tex.width)));
      const sy = Math.min(tex.height - 1, Math.max(0, Math.floor(y * tex.height)));
      const i = (sy * tex.width + sx) * 4;
      texRgb = [tex.rgba[i] / 255, tex.rgba[i + 1] / 255, tex.rgba[i + 2] / 255];
    }
    const viewDir = v3norm(v3sub(eye, wp));
    const rim = 1 - Math.max(-1, Math.min(1, v3dot(viewDir, v3norm(n))));
    const f = 1 + rim;
    return [sat(tint[0] * texRgb[0] * f), sat(tint[1] * texRgb[1] * f), sat(tint[2] * texRgb[2] * f), 1];
  }

  // bg.frag: 云 + 暗角 + 图案 (全屏背景)
  _shadeBg(u, v, uniforms, tex0, tex1, t, combos) {
    const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [0.5, 0.5, 0.5];
    const tint2 = uniforms.tint2 ? (typeof uniforms.tint2 === 'number' ? [uniforms.tint2, uniforms.tint2, uniforms.tint2] : uniforms.tint2) : [0.5, 0.5, 0.5];
    const sm = (e0, e1, x) => { const tx = sat((x - e0) / (e1 - e0)); return tx * tx * (3 - 2 * tx); };
    const cA = this._texA(tex0, u + t * 0.03, v + t * 0.03);
    const cB = this._texA(tex0, u * 2 - t * 0.0111, v * 2 - t * 0.0111);
    const clouds = Math.pow(cA * cB * 1.4, 2);
    // smoothstep(1.2, 0, d): HLSL/GLSL 实现 t=clamp((d-1.2)/(0-1.2)) → d=0 时 1 (递减 edge 的 clamp 语义)
    const vignette = sm(1.2, 0, Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2)) * 2;
    const aspect = tex0 ? tex0.height / tex0.width : 1;
    const pattern = this._texA(tex1, u * 50 * aspect, v * 50) * 0.1 * sm(0.1, 0.7, Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2));
    const mixF = v * v;
    const r = (tint[0] + (tint2[0] - tint[0]) * mixF) * (clouds + pattern) * vignette;
    const g = (tint[1] + (tint2[1] - tint[1]) * mixF) * (clouds + pattern) * vignette;
    const b = (tint[2] + (tint2[2] - tint[2]) * mixF) * (clouds + pattern) * vignette;
    // GRADIENT_FADE combo: alpha 随高度渐变 (bgfade 淡出层, 中部透明)
    let alpha = 1;
    if (combos && combos.GRADIENT_FADE) {
      alpha = sm(0.2, 0.45, Math.abs(v - 0.5));
    }
    return [sat(r), sat(g), sat(b), alpha];
  }

  // curve.frag: tint * tex.a (additive)
  _shadeCurve(u, v, uniforms, tex, t) {
    const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [0.5, 0.5, 0.5];
    const freq = uniforms.Freq != null ? uniforms.Freq : 1;
    const speed = uniforms['Scroll speed'] != null ? uniforms['Scroll speed'] : 0;
    const op = this._texA(tex, u, v * freq + t * speed * 0.1);
    return [tint[0] * op, tint[1] * op, tint[2] * op, 1];
  }

  // neonsun.frag: 程序化霓虹太阳 (渐变 + 滚动切条 + 光晕)
  _shadeNeonSun(u, v, uniforms, t) {
    const top = uniforms.colorsuntop ? (typeof uniforms.colorsuntop === 'number' ? [uniforms.colorsuntop, uniforms.colorsuntop, uniforms.colorsuntop] : uniforms.colorsuntop) : [1, 0.85, 0.05];
    const bot = uniforms.colorsunbottom ? (typeof uniforms.colorsunbottom === 'number' ? [uniforms.colorsunbottom, uniforms.colorsunbottom, uniforms.colorsunbottom] : uniforms.colorsunbottom) : [1, 0, 0.35];
    const sm = (e0, e1, x) => { const tx = sat((x - e0) / (e1 - e0)); return tx * tx * (3 - 2 * tx); };
    const vx = (u * 2 - 1) * 0.3, vy = (v * 2 - 1) * 0.3;
    const sunSize = 0.05, sunSizeSqrt = Math.sqrt(sunSize);
    const blendSunColor = (vy + sunSize * 2.5) / sunSizeSqrt;
    const colorSunR = top[0] + (bot[0] - top[0]) * blendSunColor;
    const colorSunG = top[1] + (bot[1] - top[1]) * blendSunColor;
    const colorSunB = top[2] + (bot[2] - top[2]) * blendSunColor;
    const sunRadius = vx * vx + vy * vy;
    const colorSunA = 1 - (sunRadius >= 0.05 ? 1 : 0);
    const glowAlpha = Math.pow(sm(0.08, 0.045, sunRadius), 2);
    const barPos = vy + 0.1;
    const sunCutOut = 1 - sat(sm(0, 0.005, barPos) * sm(1 - barPos * 9, 1 - barPos * 8, Math.sin(barPos * 200 + t)));
    const sunCutOutSmooth = 1 - sat(sm(0, 0.05, barPos) * sm(-1 - barPos * 8, 1 - barPos * 8, Math.sin(barPos * 200 + t)));
    const mixA = colorSunA * sunCutOut;
    const r = bot[0] + (colorSunR - bot[0]) * mixA;
    const g = bot[1] + (colorSunG - bot[1]) * mixA;
    const b = bot[2] + (colorSunB - bot[2]) * mixA;
    const a = Math.max(glowAlpha * sunCutOutSmooth, mixA);
    return [sat(r), sat(g), sat(b), a];
  }

  // neongrid.frag: 程序化霓虹网格 (格线 + 山体着色)
  _shadeNeonGrid(u, v, wp, n, uniforms, t) {
    const cNear = uniforms.gridnear ? (typeof uniforms.gridnear === 'number' ? [uniforms.gridnear, uniforms.gridnear, uniforms.gridnear] : uniforms.gridnear) : [1, 0, 0.49];
    const cFar = uniforms.gridfar ? (typeof uniforms.gridfar === 'number' ? [uniforms.gridfar, uniforms.gridfar, uniforms.gridfar] : uniforms.gridfar) : [0, 0.7, 1];
    const cBg = uniforms.gridbackground ? (typeof uniforms.gridbackground === 'number' ? [uniforms.gridbackground, uniforms.gridbackground, uniforms.gridbackground] : uniforms.gridbackground) : [0.102, 0, 0.102];
    const shadingAmt = uniforms.shading != null ? uniforms.shading : 1;
    const sm = (e0, e1, x) => { const tx = sat((x - e0) / (e1 - e0)); return tx * tx * (3 - 2 * tx); };
    const fract = (x) => x - Math.floor(x);
    const grid = [Math.abs(fract(u * 50) - 0.5), Math.abs(fract(v * 50) - 0.5)];
    // v_Vars.yz (近似, maskUVSmoothing≈0): 0.45 - uv.y * vec2(0.05, 0.75 - dampen*0.7)
    const dampenDist = Math.abs(u * 2 - 1);
    const dampenUVSmoothing = sat(Math.abs(u - 0.5) * 2);
    const varsY = 0.45 - v * 0.05;
    const varsZ = 0.45 - v * (0.75 - dampenUVSmoothing * 0.7);
    let gridAlpha = sm(varsY, 0.5, grid[0]) + sm(varsZ, 0.5, grid[1]);
    gridAlpha += (sm(0, 1, grid[0]) + sm(0, 1, grid[1])) * sat(0.3 - v);
    const alphaDistanceFade = sm(1.0, 0.9, v);
    const colorDistanceBlend = Math.pow(Math.max(0, v), 0.8);
    const nn = v3norm(n);
    const lightDir = v3norm([0 - wp[0], -0.15 - wp[1], -2 - wp[2]]);
    const shadingNear = Math.max(0, nn[2]);
    const shadingFar = Math.max(0, v3dot(lightDir, nn));
    const shadingColor = [
      shadingNear * cNear[0] * (1 - colorDistanceBlend) + shadingFar * cFar[0],
      shadingNear * cNear[1] * (1 - colorDistanceBlend) + shadingFar * cFar[1],
      shadingNear * cNear[2] * (1 - colorDistanceBlend) + shadingFar * cFar[2],
    ];
    const colorGrid = [
      cBg[0] + shadingColor[0] * shadingAmt,
      cBg[1] + shadingColor[1] * shadingAmt,
      cBg[2] + shadingColor[2] * shadingAmt,
    ];
    const mixNear = [
      cNear[0] + (cFar[0] - cNear[0]) * colorDistanceBlend,
      cNear[1] + (cFar[1] - cNear[1]) * colorDistanceBlend,
      cNear[2] + (cFar[2] - cNear[2]) * colorDistanceBlend,
    ];
    const ga = sat(gridAlpha * alphaDistanceFade);
    const res = [
      colorGrid[0] + (mixNear[0] - colorGrid[0]) * ga,
      colorGrid[1] + (mixNear[1] - colorGrid[1]) * ga,
      colorGrid[2] + (mixNear[2] - colorGrid[2]) * ga,
    ];
    return [sat(res[0]), sat(res[1]), sat(res[2]), alphaDistanceFade];
  }

  // cloudsbg.frag: 程序化云层背景 (云 + 水平线光晕)
  _shadeCloudsBg(u, v, uniforms, tex1, t) {
    const c1 = uniforms.clouds ? (typeof uniforms.clouds === 'number' ? [uniforms.clouds, uniforms.clouds, uniforms.clouds] : uniforms.clouds) : [0.027, 0.066, 0.086];
    const cH = uniforms.horizon ? (typeof uniforms.horizon === 'number' ? [uniforms.horizon, uniforms.horizon, uniforms.horizon] : uniforms.horizon) : [0.055, 0.306, 0.42];
    const sm = (e0, e1, x) => { const tx = sat((x - e0) / (e1 - e0)); return tx * tx * (3 - 2 * tx); };
    const aspect = tex1 ? tex1.height / tex1.width : 1;
    // v_TexCoordClouds: xy = (uv + t*sp0)*sc0; zw = (uv + t*sp1)*sc1; xz *= aspect; zw = (-w, z)
    const cxy0 = ((u + t * 0.0007) % 1 + 1) % 1 * 1.1;
    const cxy1 = ((v + t * 0.0007) % 1 + 1) % 1 * 1.1;
    let cz0 = ((u + t * -0.0011) % 1 + 1) % 1 * 0.7 * aspect;
    let cw0 = ((v + t * -0.0011) % 1 + 1) % 1 * 0.7;
    const cloud0 = this._texR(tex1, cxy0, cxy1);
    const cloud1 = this._texR(tex1, -cw0, cz0);
    const cloudBlend = cloud0 * cloud1;
    const lift = Math.pow(sm(0.5, 0.0, v), 2) * 2.0;
    const horizonBend = 1 - Math.cos(sat(u * 2.0 - 0.5) * 2 * Math.PI);
    const hdx = (u - 0.5) * 0.5;
    const hdy = (v - 0.6) * (1.5 - horizonBend * 0.3);
    const distanceToCenter = Math.sqrt(hdx * hdx + hdy * hdy);
    const horizonGlow = Math.pow(sm(0.5, 0.0, distanceToCenter), 2) * 2.0;
    const r = c1[0] * cloudBlend + (c1[0] * 0.5 + c1[0] * cloudBlend) * lift + cH[0] * horizonGlow;
    const g = c1[1] * cloudBlend + (c1[1] * 0.5 + c1[1] * cloudBlend) * lift + cH[1] * horizonGlow;
    const b = c1[2] * cloudBlend + (c1[2] * 0.5 + c1[2] * cloudBlend) * lift + cH[2] * horizonGlow;
    return [sat(r), sat(g), sat(b), 1];
  }

  // core.frag: albedo=tint, 光照 = ComputeLightSpecular(light[0]) + ambient 混合, 乘 v_LightScale
  _shadeCore(u, v, wp, n, eye, uniforms, t) {
    const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [1, 1, 1];
    const roughness = uniforms.Rough != null ? uniforms.Rough : 0;
    const metallic = uniforms.Metal != null ? uniforms.Metal : 0;
    const gLight = uniforms.Light != null ? uniforms.Light : 0;
    const specPower = (1.01 - roughness) * (400 + (250 - 400) * metallic);
    const specStrength = (0.5 + metallic * 0.5) * (1.0 - roughness * 0.9);
    const viewDir = v3norm(v3sub(eye, wp));
    // v_LightScale (core.vert, audio=0)
    const period = Math.PI * 4;
    const a = t * 0.4, cs = Math.cos(a), sn = Math.sin(a);
    const rx = cs * u - sn * v, ry = sn * u + cs * v;
    const animsZ = sat(Math.sin((u + v + 1) * period + t));
    const stepX = u >= 0 ? 1 : 0;
    let audioAvg = 1.0 - (u <= 0 ? 1 : 0) * animsZ * 0.4;
    const lightScale = sat(stepX + audioAvg);
    let light = [0, 0, 0];
    let spec = [0, 0, 0];
    const lights = this.lights;
    for (let li = 0; li < Math.min(lights.length, 4); li++) {
      const L = lights[li];
      const lv = v3sub(L.origin, wp);
      const dist = Math.sqrt(v3dot(lv, lv)) || 1;
      const ldir = [lv[0] / dist, lv[1] / dist, lv[2] / dist];
      const attn = sat((L.radius - dist) / L.radius);
      const h = v3norm(v3add(viewDir, ldir));
      const specDot = Math.max(0, v3dot(h, n));
      const c = [L.color[0] * L.intensity, L.color[1] * L.intensity, L.color[2] * L.intensity];
      const specTerm = Math.pow(specDot, specPower) * specStrength * attn;
      spec = [spec[0] + specTerm * c[0], spec[1] + specTerm * c[1], spec[2] + specTerm * c[2]];
      const lightDot = v3dot(ldir, n);
      const hl = lightDot * 0.5 + 0.5;
      const ld = lightDot + (hl - lightDot) * gLight;
      const a2 = attn * attn;
      light = [light[0] + c[0] * sat(ld) * a2, light[1] + c[1] * sat(ld) * a2, light[2] + c[2] * sat(ld) * a2];
    }
    const upMix = v3dot(n, [0, 1, 0]) * 0.5 + 0.5;
    const amb = [
      this.skylightColor[0] + (this.ambientColor[0] - this.skylightColor[0]) * upMix,
      this.skylightColor[1] + (this.ambientColor[1] - this.skylightColor[1]) * upMix,
      this.skylightColor[2] + (this.ambientColor[2] - this.skylightColor[2]) * upMix,
    ];
    const total = [
      tint[0] * (light[0] + amb[0]) * lightScale + spec[0],
      tint[1] * (light[1] + amb[1]) * lightScale + spec[1],
      tint[2] * (light[2] + amb[2]) * lightScale + spec[2],
    ];
    return [sat(total[0]), sat(total[1]), sat(total[2]), 1];
  }

  // backgroundsphere.frag: 程序化钻石+噪点+云 (完全照搬 shader 数学)
  _shadeBgSphere(u, v, uniforms, tex0, tex1, tex2, t) {
    const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [1, 1, 1];
    const tint2 = uniforms.tint2 ? (typeof uniforms.tint2 === 'number' ? [uniforms.tint2, uniforms.tint2, uniforms.tint2] : uniforms.tint2) : [0, 0, 0];
    const sm = (edge0, edge1, x) => { const tx = sat((x - edge0) / (edge1 - edge0)); return tx * tx * (3 - 2 * tx); };
    const smRev = (e0, e1, x) => sm(e1, e0, x);
    const pux = u * 200 + t * 0.2, puy = v * 100;
    const diamond = this._texR(tex0, pux, puy);
    const nux1 = u * 2 + t * 0.007, nuy1 = v * 2 + t * 0.007;
    const nux2 = u * 4 - t * 0.005, nuy2 = v * 4 - t * 0.005;
    const noiseA = this._texR(tex1, nux1, nuy1);
    const noiseB = this._texR(tex1, nux2, nuy2);
    const diamondBlend0 = Math.abs(v - 0.5) * 0.8;
    const diamondBlend = sm(0.2, 0.0, diamondBlend0);
    const coreNoise = sm(noiseA, noiseB, 0.3);
    const noise = sm(0.25, 0.3, noiseA * noiseB) * smRev(0.25, 0.3, noiseA * noiseB);
    const noiseV = coreNoise * noise * 4;
    const cloudA = this._texR(tex1, u + t * 0.01, v + t * 0.01);
    const cloudB = this._texR(tex1, u - t * 0.005, v - t * 0.005);
    const cloudLevel = cloudA * cloudB * 1.1;
    const cl = cloudLevel * (0.5 - Math.abs(v - 0.5));
    const hash = this._texA(tex2, pux, puy);
    let albedoR = cl + tint2[0], albedoG = cl + tint2[1], albedoB = cl + tint2[2];
    const mixF = sm(0.2, 0.02, cl);
    const ar = albedoR + ((cl + 0.5) * tint[0] - albedoR) * mixF;
    const ag = albedoG + ((cl + 0.5) * tint[1] - albedoG) * mixF;
    const ab = albedoB + ((cl + 0.5) * tint[2] - albedoB) * mixF;
    const db = diamondBlend * diamond * noiseV + diamondBlend * noiseV * 0.2;
    const fr = ar + (db * tint[0] * 10 - ar) * db;
    const fg = ag + (db * tint[1] * 10 - ag) * db;
    const fb = ab + (db * tint[2] * 10 - ab) * db;
    const hf = sm(0.2, 0.02, cl) * sm(0.02, 0.2, cl);
    return [sat(fr + hash * 0.1), sat(fg + hash * 0.1), sat(fb + hash * 0.1), 1];
  }

  // 通用材质 (generic*): 纹理 * 环境 + 点光 (近似)
  // generic.frag 完整实现: 4 光源 ComputeLightSpecular + LIGHTMAP/NORMALMAP/DIFFUSETINT/DETAILINALPHA
  _shadeGeneric(u, v, wp, n, eye, uniforms, textures, t, combos, u2, v2) {
    const tex0 = textures && textures[0];
    let albedo = this._texSample(tex0, u, v);
    if (!tex0) albedo = [1, 1, 1, 1];
    if (combos && combos.DIFFUSETINT) {
      const tint = uniforms.tint || uniforms.Color || [1, 1, 1];
      albedo[0] *= tint[0]; albedo[1] *= tint[1]; albedo[2] *= tint[2];
    }
    if (combos && combos.DETAILINALPHA && tex0) {
      const d = this._texA(tex0, u * 3, v * 3) * 2.0;
      albedo[0] *= d; albedo[1] *= d; albedo[2] *= d;
    }
    // 法线
    let normal;
    if (combos && (combos.NORMALMAP || combos.normalmap) && textures[1]) {
      const nm = this._texSample(textures[1], u, v);
      const nx = nm[0] * 2 - 1, ny = nm[1] * 2 - 1;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      normal = v3norm([nx, ny, nz]);
    } else {
      normal = v3norm(n);
    }
    const viewDir = v3norm(v3sub(eye, wp));
    const roughness = uniforms.Rough != null ? uniforms.Rough : 0.5;
    const metallic = uniforms.Metal != null ? uniforms.Metal : 0;
    const gLight = uniforms.Light != null ? uniforms.Light : 0;
    const specPower = (1.01 - roughness) * (400 + (250 - 400) * metallic);
    const specStrength = (0.5 + metallic * 0.5) * (1.0 - roughness * 0.9);
    let light = [0, 0, 0], spec = [0, 0, 0];
    const lights = this.lights;
    for (let li = 0; li < Math.min(lights.length, 4); li++) {
      const L = lights[li];
      const lv = v3sub(L.origin, wp);
      const dist = Math.sqrt(v3dot(lv, lv)) || 1;
      const ldir = [lv[0] / dist, lv[1] / dist, lv[2] / dist];
      const attn = sat((L.radius - dist) / L.radius);
      const h = v3norm(v3add(viewDir, ldir));
      const specDot = Math.max(0, v3dot(h, normal));
      const c = [L.color[0] * L.intensity, L.color[1] * L.intensity, L.color[2] * L.intensity];
      const st = Math.pow(specDot, specPower) * specStrength * attn;
      spec[0] += st * c[0]; spec[1] += st * c[1]; spec[2] += st * c[2];
      const lightDot = v3dot(ldir, normal);
      const hl = lightDot * 0.5 + 0.5;
      const ld = lightDot + (hl - lightDot) * gLight;
      const rim = metallic * 2;
      const rimTerm = Math.pow(Math.max(0, 1 - Math.max(0, v3dot(normal, viewDir))) * Math.pow(hl, 0.25), 6 - rim) * rim;
      const a2 = attn * attn;
      const dl = sat(ld) + rimTerm;
      light[0] += c[0] * dl * a2; light[1] += c[1] * dl * a2; light[2] += c[2] * dl * a2;
    }
    // 烘焙光照贴图 (generic.vert v_TexCoord.zw = 第二 UV 通道)
    if (combos && (combos.LIGHTMAP || combos.lightmap)) {
      const lmTex = textures[(combos.NORMALMAP || combos.normalmap) ? 2 : 1];
      if (lmTex) {
        // lightmap 用第 2 UV 通道 (引擎 v_TexCoord2); 无 uv2 时回退 uv1
        const lu = u2 != null ? u2 : u;
        const lv = v2 != null ? v2 : v;
        const lm = this._texSample(lmTex, lu, lv);
        light = [light[0] * lm[0], light[1] * lm[1], light[2] * lm[2]];
        spec = [spec[0] * lm[0], spec[1] * lm[1], spec[2] * lm[2]];
      }
    }
    // ambient (v_LightAmbientColor) + skylight (按法线·up 混合) + albedo*light + specular
    const upMix = v3dot(normal, [0, 1, 0]) * 0.5 + 0.5;
    const amb = [
      this.skylightColor[0] + (this.ambientColor[0] - this.skylightColor[0]) * upMix,
      this.skylightColor[1] + (this.ambientColor[1] - this.skylightColor[1]) * upMix,
      this.skylightColor[2] + (this.ambientColor[2] - this.skylightColor[2]) * upMix,
    ];
    light = [light[0] + amb[0], light[1] + amb[1], light[2] + amb[2]];
    const r = albedo[0] * light[0] + spec[0];
    const g = albedo[1] * light[1] + spec[1];
    const b = albedo[2] * light[2] + spec[2];
    return [sat(r), sat(g), sat(b), albedo[3]];
  }

  // 纹理采样 (wrap, 双线性 — 与 GPU texSample2D 默认一致)
  _texR(tex, u, v) {
    if (!tex) return 0.5;
    const x = ((u % 1) + 1) % 1, y = ((v % 1) + 1) % 1;
    const fx = x * tex.width - 0.5, fy = y * tex.height - 0.5;
    const x0 = Math.max(0, Math.min(tex.width - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(tex.height - 1, Math.floor(fy)));
    const x1 = Math.min(tex.width - 1, x0 + 1), y1 = Math.min(tex.height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * tex.width + x0) * 4, i10 = (y0 * tex.width + x1) * 4;
    const i01 = (y1 * tex.width + x0) * 4, i11 = (y1 * tex.width + x1) * 4;
    const top = tex.rgba[i00] * (1 - tx) + tex.rgba[i10] * tx;
    const bot = tex.rgba[i01] * (1 - tx) + tex.rgba[i11] * tx;
    return (top * (1 - ty) + bot * ty) / 255;
  }
  _texA(tex, u, v) {
    if (!tex) return 0;
    const x = ((u % 1) + 1) % 1, y = ((v % 1) + 1) % 1;
    const fx = x * tex.width - 0.5, fy = y * tex.height - 0.5;
    const x0 = Math.max(0, Math.min(tex.width - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(tex.height - 1, Math.floor(fy)));
    const x1 = Math.min(tex.width - 1, x0 + 1), y1 = Math.min(tex.height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * tex.width + x0) * 4 + 3, i10 = (y0 * tex.width + x1) * 4 + 3;
    const i01 = (y1 * tex.width + x0) * 4 + 3, i11 = (y1 * tex.width + x1) * 4 + 3;
    const top = tex.rgba[i00] * (1 - tx) + tex.rgba[i10] * tx;
    const bot = tex.rgba[i01] * (1 - tx) + tex.rgba[i11] * tx;
    return (top * (1 - ty) + bot * ty) / 255;
  }
  _texSample(tex, u, v, clamp = false) {
    if (!tex) return [1, 1, 1, 1];
    let x, y;
    if (clamp) {
      x = Math.min(0.999999, Math.max(0, u));
      y = Math.min(0.999999, Math.max(0, v));
    } else {
      x = ((u % 1) + 1) % 1;
      y = ((v % 1) + 1) % 1;
    }
    const fx = x * tex.width - 0.5, fy = y * tex.height - 0.5;
    const x0 = Math.max(0, Math.min(tex.width - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(tex.height - 1, Math.floor(fy)));
    const x1 = Math.min(tex.width - 1, x0 + 1), y1 = Math.min(tex.height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * tex.width + x0) * 4, i10 = (y0 * tex.width + x1) * 4;
    const i01 = (y1 * tex.width + x0) * 4, i11 = (y1 * tex.width + x1) * 4;
    const out = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const top = tex.rgba[i00 + c] * (1 - tx) + tex.rgba[i10 + c] * tx;
      const bot = tex.rgba[i01 + c] * (1 - tx) + tex.rgba[i11 + c] * tx;
      out[c] = (top * (1 - ty) + bot * ty) / 255;
    }
    return out;
  }

  _meshBounds(positions) {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of positions) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return { minX, maxX, minY, maxY };
  }

  _rasterizeMesh(mesh, tex, skinned, bounds, W, H, flipY) {
    const { uvs, indices } = mesh;
    const tw = tex.width, th = tex.height, tdata = tex.rgba;
    const ALPHA_CUTOFF = 8;
    const sample = (u, v) => {
      const fx = u * tw - 0.5, fy = v * th - 0.5;
      const x0 = Math.max(0, Math.min(tw - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(th - 1, Math.floor(fy)));
      const x1 = Math.min(tw - 1, x0 + 1), y1 = Math.min(th - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const i00 = (y0 * tw + x0) * 4, i10 = (y0 * tw + x1) * 4;
      const i01 = (y1 * tw + x0) * 4, i11 = (y1 * tw + x1) * 4;
      const pm = [
        [tdata[i00] * tdata[i00+3], tdata[i00+1] * tdata[i00+3], tdata[i00+2] * tdata[i00+3], tdata[i00+3]],
        [tdata[i10] * tdata[i10+3], tdata[i10+1] * tdata[i10+3], tdata[i10+2] * tdata[i10+3], tdata[i10+3]],
        [tdata[i01] * tdata[i01+3], tdata[i01+1] * tdata[i01+3], tdata[i01+2] * tdata[i01+3], tdata[i01+3]],
        [tdata[i11] * tdata[i11+3], tdata[i11+1] * tdata[i11+3], tdata[i11+2] * tdata[i11+3], tdata[i11+3]],
      ];
      const out = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) {
        const top = pm[0][c] * (1 - tx) + pm[1][c] * tx;
        const bot = pm[2][c] * (1 - tx) + pm[3][c] * tx;
        out[c] = top * (1 - ty) + bot * ty;
      }
      if (out[3] < ALPHA_CUTOFF) return [0, 0, 0, 0];
      const a = out[3];
      return [Math.min(255, Math.round(out[0] / a)), Math.min(255, Math.round(out[1] / a)), Math.min(255, Math.round(out[2] / a)), Math.round(a)];
    };
    const rgba = new Uint8Array(W * H * 4);
    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
      const a = [skinned[i0][0] - bounds.minX, flipY(skinned[i0][1])];
      const b = [skinned[i1][0] - bounds.minX, flipY(skinned[i1][1])];
      const c = [skinned[i2][0] - bounds.minX, flipY(skinned[i2][1])];
      const bx0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const bx1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const by0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const by1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      if (bx1 < bx0 || by1 < by0) continue;
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;
      const w0 = uvs[i0], w1 = uvs[i1], w2 = uvs[i2];
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const la = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
          const lb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
          const lc = ((a[0] - px) * (b[1] - py) - (a[1] - py) * (b[0] - px)) / area;
          if (la < -1e-4 || lb < -1e-4 || lc < -1e-4) continue;
          const di = (y * W + x) * 4;
          const u = la * w0[0] + lb * w1[0] + lc * w2[0];
          const v = la * w0[1] + lb * w1[1] + lc * w2[1];
          const s = sample(u, v);
          const srcA = s[3] / 255;
          if (srcA <= 0) continue;
          const dstA = rgba[di + 3] / 255;
          const outA = srcA + dstA * (1 - srcA);
          if (outA <= 0) continue;
          rgba[di] = Math.round((s[0] * srcA + rgba[di] * dstA * (1 - srcA)) / outA);
          rgba[di + 1] = Math.round((s[1] * srcA + rgba[di + 1] * dstA * (1 - srcA)) / outA);
          rgba[di + 2] = Math.round((s[2] * srcA + rgba[di + 2] * dstA * (1 - srcA)) / outA);
          rgba[di + 3] = Math.round(outA * 255);
        }
      }
    }
    return { width: W, height: H, rgba };
  }

  // ── 效果链 (CPU 实现 shader) ──────────────────────────────────────
  applyEffects(o, tex, t) {
    let img = tex;
    for (const ef of o.effects || []) {
      if (getVal(ef, 'visible', true) === false) continue;
      const file = ef.file || '';
      if (!file) continue;
      const name = path.basename(path.dirname(file)); // effects/waterwaves → waterwaves
      const passes = ef.passes || [];
      const pass = passes[0] || {};
      const c = pass.constantshadervalues || {};
      const combos = pass.combos || {};
      try {
        if (name === 'waterwaves') {
          img = this.effectWaterwaves(img, c, t);
        } else if (name === 'waterripple') {
          img = this.effectWaterripple(img, c, t, ef);
        } else if (name === 'shake') {
          img = this.effectShake(img, c, t);
        } else if (name === 'scroll') {
          img = this.effectScroll(img, c, t);
        } else if (name === 'tint') {
          img = this.effectTint(img, c, t, combos);
        } else if (name === 'pulse') {
          img = this.effectPulse(img, c, t, combos, pass);
        } else if (name === 'filmgrain') {
          img = this.effectFilmgrain(img, c, t, combos, pass);
        } else if (name === 'godrays') {
          img = this.effectGodrays(img, passes, t);
        } else if (name === 'opacity') {
          // opacity 通常通过 mask 控制透明度, 简化: 忽略
        } else if (name === 'blurprecise') {
          // 跳过 (性能)
        } else {
          // 其他 (iris/color_grading/bloom/lightshafts/geometric_transform) 暂不支持
        }
      } catch (e) {
        this.log('效果 ' + name + ' 失败: ' + e.message);
      }
    }
    return img;
  }

  // godrays: 5-pass 链 (downsample2 → cast → gaussian_x → gaussian_y → combine)
  // 引擎定义 (effects/godrays/effect.json): fbos 半分辨率 (scale 2)
  effectGodrays(tex, passes, t) {
    const W = tex.width, H = tex.height;
    const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
    const p0 = passes[0] || {}, p1 = passes[1] || {}, p2 = passes[2] || {}, p3 = passes[3] || {}, p4 = passes[4] || {};
    const c0 = p0.constantshadervalues || {}, c1 = p1.constantshadervalues || {}, c2 = p2.constantshadervalues || {}, c3 = p3.constantshadervalues || {};
    const k0 = p0.combos || {}, k1 = p1.combos || {}, k2 = p2.combos || {}, k3 = p3.combos || {}, k4 = p4.combos || {};
    const t0tex = (p0.textures || [])[0] ? this.loadTexture(p0.textures[0]) : null; // 通常 null (framebuffer)
    // g_Texture1: mask (默认 util/white), g_Texture2: albedo 噪声 (默认 util/clouds_256)
    const maskTex = (p0.textures || [])[1] ? this.loadTexture(p0.textures[1]) : this.loadTexture('util/white');
    const noiseTex = (p0.textures || [])[2] ? this.loadTexture(p0.textures[2]) : this.loadTexture('util/clouds_256');
    const threshold = getVal(c0, 'raythreshold', 0.5);
    const noiseAmount = getVal(c0, 'noiseamount', 0.4);
    const noiseSmooth = getVal(c0, 'noisesmoothness', 0.2);
    const noiseSpeed = getVal(c0, 'noisespeed', 0.15);
    const noiseScale = getVal(c0, 'noisescale', 3);
    const center = parseVec2(getVal(c1, 'center', '0.5 0.5'), [0.5, 0.5]);
    const rayLength = getVal(c1, 'raylength', 0.5);
    const rayIntensity = getVal(c1, 'rayintensity', 1);
    const rayColor = parseVec3(getVal(c1, 'color', '1 1 1'), [1, 1, 1]);
    const blurScale = parseVec2(getVal(c2, 'blurscale', '1 1'), [1, 1]);
    const combineMode = k4.BLENDMODE != null ? k4.BLENDMODE : 9; // add
    const noSample = (x, y) => {
      const u = (x + 0.5) / hw, v = (y + 0.5) / hh;
      const n1 = this._texSample(noiseTex, (u + t * noiseSpeed) * noiseScale, (v + t * noiseSpeed) * noiseScale, true);
      const n2x = (v * 0.633 - t * 0.5 * noiseSpeed) * noiseScale;
      const n2y = (-u * 0.633 + t * 0.5 * noiseSpeed) * noiseScale;
      const n2 = this._texSample(noiseTex, n2x, n2y, true);
      return n1[0] * n2[0];
    };
    // ── pass 0: downsample2 (半分辨率) ──
    const half = new Uint8Array(hw * hh * 4);
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const u = (x + 0.5) / hw, v = (y + 0.5) / hh;
        const s = t0tex ? this._texSample(t0tex, u, v, true) : this._texSample(tex, u, v, true);
        const mask = maskTex ? this._texSample(maskTex, u, v, true)[0] : 1;
        // noiseSample = mix(sample.a, sample.a * noise, g_NoiseAmount);  (sample.a 在 premultiply 前)
        const rawNoise = noiseTex ? noSample(x, y) : 1;
        const noiseSample = s[3] + (s[3] * rawNoise - s[3]) * noiseAmount;
        // sample.rgb *= sample.a; sample.a = 1.0
        const pr = s[0] * s[3], pg = s[1] * s[3], pb = s[2] * s[3];
        const lum = pr * 0.11 + pg * 0.59 + pb * 0.3;
        const step = lum >= threshold ? 1 : 0;
        // smoothstep(0.5-smoothness, 0.5+smoothness, noiseSample)
        const sm = Math.min(1, Math.max(0, (noiseSample - (0.5 - noiseSmooth)) / (2 * noiseSmooth)));
        const ss = sm * sm * (3 - 2 * sm);
        const di = (y * hw + x) * 4;
        half[di] = Math.round(pr * 255 * mask * step);
        half[di + 1] = Math.round(pg * 255 * mask * step);
        half[di + 2] = Math.round(pb * 255 * mask * step);
        half[di + 3] = Math.round(255 * mask * step * ss);
      }
    }
    const halfTex = { width: hw, height: hh, rgba: half };
    // ── pass 1: cast (径向光线, 30 采样, 半分辨率) ──
    const cast = new Uint8Array(hw * hh * 4);
    const sampleCount = 30, sampleIntensity = 0.1;
    const sampleDrop = sampleCount - 1;
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const u = (x + 0.5) / hw, v = (y + 0.5) / hh;
        let dx = center[0] - u, dy = center[1] - v;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1e-6) { dist = 1e-6; }
        dx /= dist; dy /= dist;
        dist = Math.min(dist, dist * rayLength);
        let tx = u + dx * dist, ty = v + dy * dist;
        const sx = dx * dist / sampleDrop, sy = dy * dist / sampleDrop;
        let ar = 0, ag = 0, ab = 0, aa = 0;
        for (let i = 0; i < sampleCount; i++) {
          const s = this._texSample(halfTex, tx, ty, true);
          const wgt = i / sampleDrop;
          ar += s[0] * wgt; ag += s[1] * wgt; ab += s[2] * wgt; aa += s[3] * wgt;
          tx -= sx; ty -= sy;
        }
        const di = (y * hw + x) * 4;
        const rr = rayIntensity * sampleIntensity * ar * rayColor[0];
        const rg = rayIntensity * sampleIntensity * ag * rayColor[1];
        const rb = rayIntensity * sampleIntensity * ab * rayColor[2];
        const ra = rayIntensity * sampleIntensity * aa;
        cast[di] = Math.round(Math.min(1, rr) * 255);
        cast[di + 1] = Math.round(Math.min(1, rg) * 255);
        cast[di + 2] = Math.round(Math.min(1, rb) * 255);
        cast[di + 3] = Math.round(Math.min(1, ra) * 255);
      }
    }
    const castTex = { width: hw, height: hh, rgba: cast };
    // ── pass 2/3: gaussian 7-tap 水平+垂直 (KERNEL=1) ──
    const gauss7 = [0.071303, 0.131514, 0.189879, 0.214607, 0.189879, 0.131514, 0.071303];
    const blurX = this._gaussPass(castTex, blurScale[0] / hw, 0, gauss7);
    const blurY = this._gaussPass(blurX, 0, blurScale[1] / hh, gauss7);
    // ── pass 4: combine (BLENDMODE add) ──
    const out = new Uint8Array(tex.rgba.length);
    const src = tex.rgba;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W, v = (y + 0.5) / H;
        const di = (y * W + x) * 4;
        const a = [src[di] / 255, src[di + 1] / 255, src[di + 2] / 255];
        const r = this._texSample(blurY, u, v, true);
        // 引擎: albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb, rays.rgb, rays.a); albedo.a += rays.a
        const blend = applyBlending(combineMode, a, [r[0], r[1], r[2]], r[3]);
        out[di] = Math.round(blend[0] * 255);
        out[di + 1] = Math.round(blend[1] * 255);
        out[di + 2] = Math.round(blend[2] * 255);
        out[di + 3] = Math.round((src[di + 3] / 255 + r[3]) * 255);
      }
    }
    return { width: W, height: H, rgba: out };
  }

  // 单方向高斯模糊 pass (输入/输出同尺寸, offset 为每 tap 的 UV 步长)
  _gaussPass(tex, offX, offY, kernel) {
    const w = tex.width, h = tex.height;
    const out = new Uint8Array(tex.rgba.length);
    const half = (kernel.length - 1) / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h;
        let r = 0, g = 0, b = 0, a = 0;
        for (let i = 0; i < kernel.length; i++) {
          const s = this._texSample(tex, u + (i - half) * offX, v + (i - half) * offY, true);
          r += s[0] * kernel[i]; g += s[1] * kernel[i]; b += s[2] * kernel[i]; a += s[3] * kernel[i];
        }
        const di = (y * w + x) * 4;
        out[di] = Math.round(r * 255); out[di + 1] = Math.round(g * 255);
        out[di + 2] = Math.round(b * 255); out[di + 3] = Math.round(a * 255);
      }
    }
    return { width: w, height: h, rgba: out };
  }

  // scroll: v_Scroll = sign(s)*s²*t; uv' = frac((uv + v_Scroll) * g_Scale); 采样 g_Texture0
  effectScroll(tex, c, t) {
    const rep = parseVec2(getVal(c, 'repeat', '1 1'), [1, 1]);
    const sx = getVal(c, 'speedx', 0.2);
    const sy = getVal(c, 'speedy', 0.2);
    const scrollX = Math.sign(sx) * sx * sx * t;
    const scrollY = Math.sign(sy) * sy * sy * t;
    const w = tex.width, h = tex.height;
    const src = tex.rgba;
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h;
        const nu = _frac((u + scrollX) * rep[0]);
        const nv = _frac((v + scrollY) * rep[1]);
        const s = this._texSample(tex, nu, nv);
        const di = (y * w + x) * 4;
        out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
        out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
      }
    }
    return { width: w, height: h, rgba: out };
  }

  // tint: albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb, g_TintColor, g_BlendAlpha)
  effectTint(tex, c, t, combos) {
    const mode = combos.BLENDMODE || 2; // 默认 multiply
    const alpha = getVal(c, 'alpha', 1);
    const color = parseVec3(getVal(c, 'color', '1 1 1'), [1, 1, 1]);
    const w = tex.width, h = tex.height;
    const src = tex.rgba;
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h;
        const s = this._texSample(tex, u, v);
        const rgb = applyBlending(mode, [s[0], s[1], s[2]], color, alpha);
        const di = (y * w + x) * 4;
        out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
        out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
      }
    }
    return { width: w, height: h, rgba: out };
  }

  // pulse: blend = mask.a * g_Multiply; albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb, mask.rgb, blend)
  effectPulse(tex, c, t, combos, pass) {
    const mode = combos.BLENDMODE || 2;
    const mult = getVal(c, 'multiply', 1);
    const tex1 = pass.textures && pass.textures[1] ? this.loadTexture(pass.textures[1]) : null;
    const w = tex.width, h = tex.height;
    const src = tex.rgba;
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h;
        const s = this._texSample(tex, u, v);
        const mask = tex1 ? this._texSample(tex1, u, v) : [1, 1, 1, 1];
        const blend = mask[3] * mult;
        const rgb = applyBlending(mode, [s[0], s[1], s[2]], [mask[0], mask[1], mask[2]], blend);
        const di = (y * w + x) * 4;
        out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
        out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
      }
    }
    return { width: w, height: h, rgba: out };
  }

  // filmgrain: 双噪声采样 (time-offset 卷动), GREYSCALE→灰度, saturate(n1*n2), pow, ApplyBlending
  effectFilmgrain(tex, c, t, combos, pass) {
    const mode = combos.BLENDMODE || 12; // 默认 softlight
    const greyscale = combos.GREYSCALE != null ? combos.GREYSCALE : 1;
    const noiseAlpha = getVal(c, 'ui_editor_properties_strength', 2);
    const noisePower = getVal(c, 'ui_editor_properties_power', 0.5);
    const noiseScale = getVal(c, 'ui_editor_properties_scale', 10);
    const tex1 = pass.textures && pass.textures[1] ? this.loadTexture(pass.textures[1]) : this.loadTexture('util/noise');
    const hasMask = combos.MASK === 1;
    const tex2 = hasMask && pass.textures && pass.textures[2] ? this.loadTexture(pass.textures[2]) : null;
    const aspect = tex.width / tex.height;
    const w = tex.width, h = tex.height;
    const out = new Uint8Array(tex.rgba.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h;
        const s = this._texSample(tex, u, v);
        // v_TexCoordNoise.xy = (uv + t) * scale * (aspect,1); .zw = (uv - t*2.5) * scale * 0.52 * (aspect,1)
        const n1 = tex1 ? this._texSample(tex1, (u + t) * noiseScale * aspect, (v + t) * noiseScale) : [1, 1, 1, 1];
        const n2 = tex1 ? this._texSample(tex1, (u - t * 2.5) * noiseScale * 0.52 * aspect, (v - t * 2.5) * noiseScale * 0.52) : [1, 1, 1, 1];
        let noise = [n1[0], n1[1], n1[2]];
        let noise2 = [n2[1], n2[2], n2[0]]; // .gbr
        if (greyscale === 1) {
          const g1 = _greyscale(noise), g2 = _greyscale(noise2);
          noise = [g1, g1, g1]; noise2 = [g2, g2, g2];
        }
        const mul = _sat3([noise[0] * noise2[0], noise[1] * noise2[1], noise[2] * noise2[2]]);
        const np = mul.map((v) => Math.pow(v, noisePower));
        let blend = noiseAlpha;
        if (tex2) blend *= this._texSample(tex2, u, v)[0];
        const rgb = applyBlending(mode, [s[0], s[1], s[2]], np, blend);
        const di = (y * w + x) * 4;
        out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
        out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
      }
    }
    return { width: w, height: h, rgba: out };
  }

  // waterwaves: 双波 sin 位移 (shader 精确数学)
  effectWaterwaves(tex, c, t) {
    const dir1 = c.direction != null ? c.direction : 0;
    const scale1 = c.scale != null ? c.scale : 200;
    const speed1 = c.speed != null ? c.speed : 5;
    const exp1 = c.exponent != null ? c.exponent : 1;
    const strength = c.strength != null ? c.strength : 0.1;
    const dual = c.direction2 != null || c.scale2 != null;
    const dir2 = c.direction2 != null ? c.direction2 : 0;
    const scale2 = c.scale2 != null ? c.scale2 : 66;
    const speed2 = c.speed2 != null ? c.speed2 : 3;
    const exp2 = c.exponent2 != null ? c.exponent2 : 1;
    const offset2 = c.offset2 != null ? c.offset2 : 0;
    // mask 纹理 (可选)
    let mask = null;
    const texArr = (ef => ef.passes?.[0]?.textures)({ passes: [{ textures: this._currentEffectTextures }] }) || [];
    // 简化: 无 mask 时 mask=1

    const w = tex.width, h = tex.height;
    const src = tex.rgba;
    const out = new Uint8Array(src.length);
    const vd1 = [Math.sin(dir1), Math.cos(dir1)]; // rotateVec2((0,1), dir)
    const vd2 = [Math.sin(dir2), Math.cos(dir2)];
    const off1 = [vd1[1], -vd1[0]];
    const off2 = [vd2[1], -vd2[0]];
    const s = strength * strength;
    // 低分辨率加速: 每 2x2 计算一次
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h;
        const pos = Math.abs((u - 0.5) * vd1[0] + (v - 0.5) * vd1[1]);
        let dist = t * speed1 + (u * vd1[0] + v * vd1[1]) * scale1;
        const val1 = Math.sin(dist);
        const s1 = Math.sign(val1);
        const p1 = Math.pow(Math.abs(val1), exp1);
        let uu = u, vv = v;
        if (dual) {
          let dist2 = (t + offset2) * speed2 + (u * vd2[0] + v * vd2[1]) * scale2;
          const val2 = Math.sin(dist2);
          const s2 = Math.sign(val2);
          const p2 = Math.pow(Math.abs(val2), exp2);
          uu += p1 * s1 * p2 * s2 * off1[0] * s;
          vv += p1 * s1 * p2 * s2 * off1[1] * s;
        } else {
          uu += p1 * s1 * off1[0] * s;
          vv += p1 * s1 * off1[1] * s;
        }
        const sx = Math.max(0, Math.min(w - 1, Math.floor(uu * w)));
        const sy = Math.max(0, Math.min(h - 1, Math.floor(vv * h)));
        const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
        out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
      }
    }
    return { width: w, height: h, rgba: out };
  }

  // waterripple: 法线贴图采样位移 (简化: 纯 CPU 波纹)
  effectWaterripple(tex, c, t, ef) {
    // 需要 waterripplenormal 纹理; 简化实现: 圆形波纹位移
    const strength = c.ripplestrength != null ? c.ripplestrength : 0.1;
    const animSpeed = c.animationspeed != null ? c.animationspeed : 0.15;
    const scale = c.scale != null ? c.scale : 1;
    const w = tex.width, h = tex.height;
    const src = tex.rgba;
    const out = new Uint8Array(src.length);
    const cx = w / 2, cy = h / 2;
    const maxR = Math.hypot(cx, cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const r = Math.hypot(dx, dy);
        const phase = t * animSpeed * 4 + r / maxR * Math.PI * 4 * scale;
        const amp = Math.sin(phase) * strength * 3;
        const sx = Math.max(0, Math.min(w - 1, Math.round(x + (dx / (r + 1e-6)) * amp)));
        const sy = Math.max(0, Math.min(h - 1, Math.round(y + (dy / (r + 1e-6)) * amp)));
        const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
        out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
      }
    }
    return { width: w, height: h, rgba: out };
  }

  // shake: 时间噪声位移
  effectShake(tex, c, t) {
    const speed = c.speed != null ? c.speed : 1;
    const strength = c.strength != null ? c.strength : 0.1;
    const w = tex.width, h = tex.height;
    const src = tex.rgba;
    const out = new Uint8Array(src.length);
    const s = strength * strength;
    // 简化: 均匀时间位移 + 轻微空间变化
    const ox = Math.sin(t * speed * 2.3) * s * 30;
    const oy = Math.cos(t * speed * 1.7) * s * 30;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const phase = t * speed + x * 0.001 + y * 0.0013;
        const shx = Math.sin(phase) * s * 15 + ox;
        const shy = Math.cos(phase * 1.3) * s * 15 + oy;
        const sx = Math.max(0, Math.min(w - 1, Math.round(x + shx)));
        const sy = Math.max(0, Math.min(h - 1, Math.round(y + shy)));
        const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
        out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
      }
    }
    return { width: w, height: h, rgba: out };
  }

  // ── Particle 对象渲染 (完整模拟) ──────────────────────────────────
  renderParticleSystem(o, t) {
    // 读取粒子定义 (文件或内联)
    let def = null;
    const particleVal = o.particle;
    if (typeof particleVal === 'string') {
      def = this.pkg.readJson(particleVal);
    } else if (typeof particleVal === 'object') {
      def = particleVal;
    }
    if (!def) return;
    const sys = this._buildParticleSystem(o, def);
    if (!sys) return;
    // 模拟期也使用确定性 RNG (发射/初始器), 保证同场景帧可复现
    const origRandom = Math.random;
    Math.random = sys.rng;
    try {
      this._simulateParticleSystem(sys, t);
      this._drawParticles(sys);
    } finally {
      Math.random = origRandom;
    }
  }

  _buildParticleSystem(o, def) {
    const tr = this.resolveTransform(o);
    const origin = tr.origin;
    const scale = tr.scale;
    const angle = tr.angle;
    const inst = o.instanceoverride || {};
    const alphaMul = getVal(inst, 'alpha', 1);
    const rateMul = getVal(inst, 'rate', 1);
    const maxCount = def.maxcount || 100;
    // 确定性伪随机: 粒子生成期间替换 Math.random, 保证同场景渲染可复现 (缓存一致)
    const rng = this._particleRng(o);
    const origRandom = Math.random;
    Math.random = rng;
    try {
      const sys = this._buildParticleSystemInner(o, def, { tr, origin, scale, angle, inst, alphaMul, rateMul, maxCount, rng });
      return sys;
    } finally {
      Math.random = origRandom;
    }
  }

  _buildParticleSystemInner(o, def, ctx) {
    const { tr, origin, scale, angle, inst, alphaMul, rateMul, maxCount, rng } = ctx;
    const emitters = (def.emitter || []).map((e) => this._parseEmitter(e, scale, angle));
    const initializers = (def.initializer || []).map((i) => this._parseInitializer(i)).filter(Boolean);
    const operators = (def.operator || []).map((op) => this._parseOperator(op)).filter(Boolean);
    // 纹理 + 材质属性 (blending / usershadervalues)
    let tex = null;
    let blending = 'translucent';
    let color1 = [1, 1, 1], color2 = [1, 1, 1];
    if (def.material) {
      const mat = this.pkg.readJson(def.material);
      const pass = mat && mat.passes && mat.passes[0] ? mat.passes[0] : null;
      if (pass) {
        if (pass.textures && pass.textures.length) tex = this.loadTexture(pass.textures[0]);
        if (pass.blending) blending = pass.blending;
        const usv = pass.usershadervalues;
        if (usv) for (const [prop, uniform] of Object.entries(usv)) {
          const v = this.userProps[prop];
          if (uniform === 'color1') color1 = typeof v === 'string' ? parseVec3(v, [1, 1, 1]) : color1;
          else if (uniform === 'color2') color2 = typeof v === 'string' ? parseVec3(v, [1, 1, 1]) : color2;
        }
      }
    }
    // 正交投影缩放: 场景单位 → 画布像素 (原生 ortho(-w/2,w/2,-h/2,h/2) 投影)
    let projScale = null;
    const ortho = this.scene.general && this.scene.general.orthogonalprojection;
    if (ortho && ortho.width) {
      projScale = [this.W / ortho.width, this.H / (ortho.height || 1080)];
    }
    return {
      o, origin, scale, angle, alphaMul, rateMul, maxCount,
      emitters, initializers, operators, tex, blending, color1, color2, projScale,
      animFrames: def.animationmode === 'sequence' ? (def.sequencemultiplier || 1) : 0,
      starttime: def.starttime || 0,
      particles: [],
      acc: 0, count: 0, t0: this.time,
      // 确定性伪随机 (mulberry32): 种子来自场景路径, 保证同场景渲染可复现 (缓存一致)
      rng: this._particleRng(o),
    };
  }

  // mulberry32 确定性 RNG (种子 = 对象 id + 场景路径 hash)
  _particleRng(o) {
    let seed = 0x9e3779b9;
    const str = String(this.pkgPath) + '|' + (o.id != null ? o.id : o.name || '') + '|' + (o.origin || '');
    for (let i = 0; i < str.length; i++) {
      seed = (seed ^ str.charCodeAt(i)) * 16777619 >>> 0;
    }
    return () => {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  _parseEmitter(e, scale, angle) {
    const name = e.name || 'boxrandom';
    const rate = (e.rate || 0) * (e.rate != null ? 1 : 1);
    return {
      name,
      rate: e.rate || 10,
      instantaneous: e.instantaneous || 0,
      delay: e.delay || 0,
      duration: e.duration || 0,
      origin: parseVec3(e.origin, [0, 0, 0]),
      directions: parseVec3(e.directions, [1, 1, 0]),
      distanceMin: parseVec3(e.distancemin, [0, 0, 0]),
      distanceMax: parseVec3(e.distancemax, [256, 256, 0]),
      sign: parseVec3(e.sign, [0, 0, 0]).map((x) => (typeof x === 'number' ? x : 0)),
      speedMin: e.speedmin || 0,
      speedMax: e.speedmax || 0,
      cone: e.cone || 0,
      controlPoint: e.controlpoint != null ? e.controlpoint : -1,
      flags: e.flags || 0,
      scale, angle,
    };
  }

  _parseInitializer(i) {
    const name = i.name || '';
    return { name, params: i };
  }

  _parseOperator(op) {
    const name = op.name || '';
    return { name, params: op };
  }

  _simulateParticleSystem(sys, t) {
    // 引擎 starttime: 粒子系统从 starttime 后启动 (t < starttime → 无粒子)
    const st = sys.starttime || 0;
    // 从 0 开始模拟到 t-starttime (静态帧渲染: 一次性推进)
    if (sys._simulatedTo == null) sys._simulatedTo = 0;
    let simT = sys._simulatedTo;
    const target = Math.max(0, t - st);
    let guard = 0;
    while (simT < target && guard < 2000) {
      const dt = Math.min(0.05, target - simT);
      this._stepParticles(sys, dt, simT);
      simT += dt;
      guard++;
    }
    sys._simulatedTo = target;
  }

  _stepParticles(sys, dt, simT) {
    // 发射
    for (const em of sys.emitters) {
      if (em.delay > 0 && simT < em.delay) continue;
      let toEmit = 0;
      if (em.instantaneous > 0 && !em._emitted) {
        toEmit = em.instantaneous;
        em._emitted = true;
      }
      sys.acc += dt * em.rate * sys.rateMul;
      toEmit += Math.floor(sys.acc);
      sys.acc -= Math.floor(sys.acc);
      const cap = em.flags & 2 ? 1 : toEmit;
      for (let k = 0; k < cap && sys.count < sys.maxCount; k++) {
        const p = this._spawnParticle(sys, em);
        sys.particles.push(p);
        sys.count++;
      }
    }
    // 更新
    for (const p of sys.particles) p.age += dt;
    for (const op of sys.operators) this._applyOperator(sys, op, dt, simT);
    // 移除死亡
    for (let i = sys.particles.length - 1; i >= 0; i--) {
      if (sys.particles[i].age >= sys.particles[i].lifetime) sys.particles.splice(i, 1);
    }
  }

  _spawnParticle(sys, em) {
    // 粒子系统: origin 是场景坐标 (y 向上), 像素中心 = (origin.x, H - origin.y)
    const ox = em.origin[0] * em.scale[0], oy = -em.origin[1] * em.scale[1];
    let px, py;
    if (em.name === 'sphererandom') {
      const angle = Math.random() * Math.PI * 2;
      const minR = em.distanceMin[0], maxR = em.distanceMax[0];
      const r = minR + Math.random() * (maxR - minR);
      px = Math.cos(angle) * r * em.directions[0];
      py = Math.sin(angle) * r * em.directions[1];
    } else {
      // boxrandom: 每轴在 [min,max] 内随机, 随机翻转符号
      const rx = em.distanceMin[0] + Math.random() * (em.distanceMax[0] - em.distanceMin[0]);
      const ry = em.distanceMin[1] + Math.random() * (em.distanceMax[1] - em.distanceMin[1]);
      px = (Math.random() < 0.5 ? -rx : rx) * em.directions[0];
      py = (Math.random() < 0.5 ? -ry : ry) * em.directions[1];
    }
    // 应用系统缩放和旋转
    const cos = Math.cos(-em.angle), sin = Math.sin(-em.angle);
    const rx = px * cos - py * sin, ry = px * sin + py * cos;
    // 应用 initializers
    const p = {
      pos: [ox + rx * em.scale[0], oy + ry * em.scale[1], 0],
      // 纯场景坐标 (y 向上, 未翻转/未烘焙 H) — 正交投影场景用
      scenePos: [em.origin[0] * em.scale[0] + rx * em.scale[0], em.origin[1] * em.scale[1] + ry * em.scale[1], 0],
      vel: [0, 0, 0], angVel: 0, rot: 0,
      alpha: 1, size: 20, color: [1, 1, 1],
      life: 1, age: 0, alive: true,
      oscAlpha: null, oscSize: null, oscPos: null,
    };
    for (const init of sys.initializers) this._applyInitializer(p, init);
    // 像素坐标: 屏幕中心 = (origin.x, H - origin.y)
    const sx = sys.origin[0] + p.pos[0];
    const sy = this.H - sys.origin[1] + p.pos[1];
    p.pos = [sx, sy, 0];
    return p;
  }

  _applyInitializer(p, init) {
    const pr = init.params;
    switch (init.name) {
      case 'sizerandom': {
        const min = getVal(pr, 'min', 1), max = getVal(pr, 'max', 20);
        p.size = min + Math.random() * (max - min);
        p._initSize = p.size;
        break;
      }
      case 'alpharandom': {
        const min = getVal(pr, 'min', 0.05), max = getVal(pr, 'max', 1);
        p.alpha = min + Math.random() * (max - min);
        p._initAlpha = p.alpha;
        break;
      }
      case 'lifetimerandom': {
        const min = getVal(pr, 'min', 0), max = getVal(pr, 'max', 1);
        p.life = min + Math.random() * (max - min);
        break;
      }
      case 'velocityrandom': {
        const min = parseVec3(getVal(pr, 'min'), [-32, -32, -32]);
        const max = parseVec3(getVal(pr, 'max'), [32, 32, 32]);
        p.vel = [
          min[0] + Math.random() * (max[0] - min[0]),
          min[1] + Math.random() * (max[1] - min[1]),
          min[2] + Math.random() * (max[2] - min[2]),
        ];
        break;
      }
      case 'rotationrandom': {
        const min = parseVec3(getVal(pr, 'min'), [0, 0, 0]);
        const max = parseVec3(getVal(pr, 'max'), [0, 0, Math.PI * 2]);
        p.rot = min[2] + Math.random() * (max[2] - min[2]);
        break;
      }
      case 'angularvelocityrandom': {
        const min = parseVec3(getVal(pr, 'min'), [0, 0, -5]);
        const max = parseVec3(getVal(pr, 'max'), [0, 0, 5]);
        p.angVel = min[2] + Math.random() * (max[2] - min[2]);
        break;
      }
      case 'colorrandom': {
        const min = parseVec3(getVal(pr, 'min'), [0, 0, 0]);
        const max = parseVec3(getVal(pr, 'max'), [1, 1, 1]);
        // 引擎初始器值域 0-255, 着色器内归一化到 0..1 (v_Color.r 参与 mix)
        const k = (max[0] > 1 || max[1] > 1 || max[2] > 1 || min[0] > 1 || min[1] > 1 || min[2] > 1) ? 1 / 255 : 1;
        p.color = [
          (min[0] + Math.random() * (max[0] - min[0])) * k,
          (min[1] + Math.random() * (max[1] - min[1])) * k,
          (min[2] + Math.random() * (max[2] - min[2])) * k,
        ];
        break;
      }
    }
  }

  _applyOperator(sys, op, dt, t) {
    const pr = op.params;
    for (const p of sys.particles) {
      switch (op.name) {
        case 'movement': {
          const gravity = parseVec3(getVal(pr, 'gravity'), [0, 0, 0]);
          const drag = getVal(pr, 'drag', 0);
          p.pos[0] += p.vel[0] * dt;
          p.pos[1] += p.vel[1] * dt;
          p.vel[0] += gravity[0] * dt;
          p.vel[1] += -gravity[1] * dt; // Y flip
          const df = Math.max(0, 1 - drag * dt);
          p.vel[0] *= df; p.vel[1] *= df;
          if (p.scenePos) {
            // 场景坐标 (y 向上): x 同向, y 与画布 y-down 反向
            p.scenePos[0] += p.vel[0] * dt;
            p.scenePos[1] += -p.vel[1] * dt;
          }
          break;
        }
        case 'angularmovement': {
          const force = parseVec3(getVal(pr, 'force'), [0, 0, 0]);
          const drag = getVal(pr, 'drag', 0);
          p.rot += p.angVel * dt;
          p.angVel += force[2] * dt;
          p.angVel *= Math.max(0, 1 - drag * dt);
          break;
        }
        case 'alphafade': {
          const fadeIn = getVal(pr, 'fadeintime', 0.5);
          const fadeOut = getVal(pr, 'fadeouttime', 0.5);
          const lifePos = p.life > 0 ? p.age / p.life : 1;
          const base = p._initAlpha ?? 1;
          // 原生: fade = fadeValue(life, 0, fadeIn, 0, 1) = smoothstep
          let fade;
          if (lifePos <= fadeIn) {
            const tt = fadeIn > 0 ? Math.min(1, Math.max(0, lifePos / fadeIn)) : 1;
            fade = tt * tt * (3 - 2 * tt);
          } else if (lifePos > fadeOut) {
            const tt = 1 - fadeOut > 0 ? Math.min(1, Math.max(0, (lifePos - fadeOut) / (1 - fadeOut))) : 1;
            fade = 1 - tt * tt * (3 - 2 * tt);
          } else fade = 1;
          p.alpha = base * fade;
          // 原生每帧刷新振荡器基数 (oscillateAlpha 与 alphafade 组合的关键)
          if (p.oscAlpha) p.oscAlpha.base = p.alpha;
          break;
        }
        case 'sizechange': {
          const st = getVal(pr, 'starttime', 0), et = getVal(pr, 'endtime', 1);
          const sv = getVal(pr, 'startvalue', 1), ev = getVal(pr, 'endvalue', 0);
          const lifePos = p.life > 0 ? p.age / p.life : 1;
          const t01 = et > st ? Math.max(0, Math.min(1, (lifePos - st) / (et - st))) : 1;
          const tt = t01 * t01 * (3 - 2 * t01);
          p.size = (p._initSize ?? 20) * (sv + (ev - sv) * tt);
          if (p.oscSize) p.oscSize.base = p.size;
          break;
        }
        case 'alphachange': {
          const st = getVal(pr, 'starttime', 0), et = getVal(pr, 'endtime', 1);
          const sv = getVal(pr, 'startvalue', 1), ev = getVal(pr, 'endvalue', 0);
          const lifePos = p.life > 0 ? p.age / p.life : 1;
          const t01 = et > st ? Math.max(0, Math.min(1, (lifePos - st) / (et - st))) : 1;
          const tt = t01 * t01 * (3 - 2 * t01);
          p.alpha = (p._initAlpha ?? 1) * (sv + (ev - sv) * tt);
          if (p.oscAlpha) p.oscAlpha.base = p.alpha;
          break;
        }
        case 'turbulence': {
          const scale = getVal(pr, 'scale', 0.005);
          const speedMin = getVal(pr, 'speedmin', 500), speedMax = getVal(pr, 'speedmax', 1000);
          const mask = parseVec3(getVal(pr, 'mask'), [1, 1, 0]);
          const sp = speedMin + Math.random() * (speedMax - speedMin);
          const phase = Math.random() * Math.PI * 2;
          const nx = Math.sin(p.pos[0] * scale * 2 + phase + t * 0.1);
          const ny = Math.sin(p.pos[1] * scale * 2 + phase + t * 0.13);
          p.vel[0] += nx * sp * dt * mask[0];
          p.vel[1] += ny * sp * dt * mask[1];
          break;
        }
        case 'oscillatealpha': {
          const fMin = getVal(pr, 'frequencymin', 0), fMax = getVal(pr, 'frequencymax', 10);
          const sMin = getVal(pr, 'scalemin', 0), sMax = getVal(pr, 'scalemax', 1);
          if (!p.oscAlpha) {
            p.oscAlpha = { f: fMin + Math.random() * (fMax - fMin), ph: Math.random() * Math.PI * 2, base: p.alpha };
          }
          const cosVal = (Math.cos(p.oscAlpha.f * p.age + p.oscAlpha.ph) + 1) * 0.5;
          p.alpha = p.oscAlpha.base * (sMin + (sMax - sMin) * cosVal);
          break;
        }
        case 'oscillatesize': {
          const fMin = getVal(pr, 'frequencymin', 0), fMax = getVal(pr, 'frequencymax', 10);
          const sMin = getVal(pr, 'scalemin', 0.8), sMax = getVal(pr, 'scalemax', 1.2);
          if (!p.oscSize) {
            p.oscSize = { f: fMin + Math.random() * (fMax - fMin), ph: Math.random() * Math.PI * 2, base: p.size };
          }
          const cosVal = (Math.cos(p.oscSize.f * p.age + p.oscSize.ph) + 1) * 0.5;
          p.size = p.oscSize.base * (sMin + (sMax - sMin) * cosVal);
          break;
        }
        case 'oscillateposition': {
          const fMin = getVal(pr, 'frequencymin', 0), fMax = getVal(pr, 'frequencymax', 5);
          const sMin = getVal(pr, 'scalemin', 0), sMax = getVal(pr, 'scalemax', 10);
          const mask = parseVec3(getVal(pr, 'mask'), [1, 1, 0]);
          if (!p.oscPos) {
            p.oscPos = {
              f: [0, 0, 0].map(() => fMin + Math.random() * (fMax - fMin)),
              ph: [0, 0, 0].map(() => Math.random() * Math.PI * 2),
              sc: [0, 0, 0].map(() => sMin + Math.random() * (sMax - sMin)),
            };
          }
          for (let a = 0; a < 2; a++) {
            const w = 2 * Math.PI * p.oscPos.f[a] / (2 * Math.PI);
            const move = -p.oscPos.sc[a] * w * Math.sin(w * p.age + p.oscPos.ph[a]) * dt;
            p.pos[a] += move * mask[a];
            if (p.scenePos) p.scenePos[a] += (a === 0 ? move : -move) * mask[a];
          }
          break;
        }
      }
    }
  }

  _drawParticles(sys) {
    const tex = sys.tex;
    const alphaMul = sys.alphaMul;
    const W = this.W, H = this.H;
    const canvas = this.canvas;
    const additive = sys.blending === 'additive';
    // 原生 genericparticle.vert: v_Color.a *= 0.5; v_Color.rgb = mix(color1, color2, v_Color.r)
    // (USERCOLORBLEND); 正交场景按投影缩放场景单位→像素
    const ps = sys.projScale;
    for (const p of sys.particles) {
      const lifePos = p.life > 0 ? p.age / p.life : 1;
      if (lifePos >= 1) continue;
      const a = Math.max(0, p.alpha) * alphaMul * 0.5;
      if (a <= 0.002) continue;
      const sz = Math.max(0.5, p.size);
      // 正交场景: 用 scenePos (场景坐标, y 向上) 经投影缩放; 否则用画布坐标
      const x = ps ? (p.scenePos ? p.scenePos[0] * ps[0] : p.pos[0] * ps[0]) : p.pos[0];
      const y = ps ? (p.scenePos ? this.H - p.scenePos[1] * ps[1] : p.pos[1] * ps[1]) : p.pos[1];
      const halfX = (ps ? sz * ps[0] : sz) / 2;
      const halfY = (ps ? sz * ps[1] : sz) / 2;
      if (tex) {
        // 原生 particle.frag: albedo = tex.r; blur = smoothstep(-1,1,pos.z);
        // blurAmount = blur*0.4; albedo = smoothstep(0.4-blurAmount, 0.5+blurAmount, albedo)
        // 粒子 z≈0 → blur=0.5 → 软边 (0.2, 0.7)
        const tw = tex.width, th = tex.height;
        const colorR = sys.color1[0] + (sys.color2[0] - sys.color1[0]) * p.color[0];
        const colorG = sys.color1[1] + (sys.color2[1] - sys.color1[1]) * p.color[0];
        const colorB = sys.color1[2] + (sys.color2[2] - sys.color1[2]) * p.color[0];
        const x0 = Math.floor(x - halfX), y0 = Math.floor(y - halfY);
        const x1 = Math.ceil(x + halfX), y1 = Math.ceil(y + halfY);
        for (let py = y0; py <= y1; py++) {
          if (py < 0 || py >= H) continue;
          for (let px = x0; px <= x1; px++) {
            if (px < 0 || px >= W) continue;
            const nx = (px - x) / halfX, ny = (py - y) / halfY;
            if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;
            const u = (nx + 1) / 2, v = (ny + 1) / 2;
            const si = (Math.min(th - 1, Math.floor(v * th)) * tw + Math.min(tw - 1, Math.floor(u * tw))) * 4;
            const texR = tex.rgba[si] / 255;
            // 软边 smoothstep(0.2, 0.7, r)
            let albedo = Math.min(1, Math.max(0, (texR - 0.2) / 0.5));
            albedo = albedo * albedo * (3 - 2 * albedo);
            if (albedo <= 0.004) continue;
            const sa = a * albedo;
            const di = (py * W + px) * 4;
            const sr = colorR * sa * 255, sg = colorG * sa * 255, sb = colorB * sa * 255;
            if (additive) {
              // additive: dst += src*srcA (clamp)
              canvas.data[di] = Math.min(255, canvas.data[di] + sr);
              canvas.data[di + 1] = Math.min(255, canvas.data[di + 1] + sg);
              canvas.data[di + 2] = Math.min(255, canvas.data[di + 2] + sb);
              canvas.data[di + 3] = 255;
            } else {
              const dstA = canvas.data[di + 3] / 255;
              const outA = sa + dstA * (1 - sa);
              if (outA <= 0) continue;
              canvas.data[di] = Math.round((sr + canvas.data[di] * dstA * (1 - sa)) / outA);
              canvas.data[di + 1] = Math.round((sg + canvas.data[di + 1] * dstA * (1 - sa)) / outA);
              canvas.data[di + 2] = Math.round((sb + canvas.data[di + 2] * dstA * (1 - sa)) / outA);
              canvas.data[di + 3] = Math.round(outA * 255);
            }
          }
        }
      } else {
        // 无纹理: 圆形占位 (additive)
        const r = Math.max(1, (halfX + halfY) / 2);
        for (let py = Math.floor(y - r); py <= Math.ceil(y + r); py++) {
          for (let px = Math.floor(x - r); px <= Math.ceil(x + r); px++) {
            if (px < 0 || py < 0 || px >= W || py >= H) continue;
            if ((px - x) ** 2 + (py - y) ** 2 > r * r) continue;
            const di = (py * W + px) * 4;
            const sr = a * 255;
            if (additive) {
              canvas.data[di] = Math.min(255, canvas.data[di] + sr);
              canvas.data[di + 1] = Math.min(255, canvas.data[di + 1] + sr);
              canvas.data[di + 2] = Math.min(255, canvas.data[di + 2] + sr);
              canvas.data[di + 3] = 255;
            } else {
              const dstA = canvas.data[di + 3] / 255;
              const outA = a + dstA * (1 - a);
              canvas.data[di] = Math.round((sr + canvas.data[di] * dstA * (1 - a)) / outA);
              canvas.data[di + 1] = Math.round((sr + canvas.data[di + 1] * dstA * (1 - a)) / outA);
              canvas.data[di + 2] = Math.round((sr + canvas.data[di + 2] * dstA * (1 - a)) / outA);
              canvas.data[di + 3] = Math.round(outA * 255);
            }
          }
        }
      }
    }
  }
}




