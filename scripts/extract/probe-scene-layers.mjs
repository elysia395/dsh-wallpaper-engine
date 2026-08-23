/**
 * probe-scene-layers.mjs — 路径 A 可行性探针：把 WE 场景壁纸的**全部图层**
 * 从 scene.pkg 中提取、解码为 PNG/JPEG，并输出合成所需 layers.json
 * （对象变换/混合/透明度），供浏览器端 canvas 合成验证"不止于静态帧"。
 *
 * 只读场景文件，写出到 <outDir>（默认 ./scene-layers-out/）。
 *
 * Usage: node scripts/probe-scene-layers.mjs <scene.pkg 或 scene 目录> [outDir]
 *   - 传 scene.pkg 文件：按打包场景解析；
 *   - 传目录（含 scene.json）：按松散场景解析（同一条链）。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { decodeTex, parseTex } from '../lib/pkg-extract.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [ , , sceneArg, outArg ] = process.argv;
const scenePath = resolve(sceneArg || 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg');
const outDir = resolve(outArg || join(root, 'scene-layers-out'));
mkdirSync(outDir, { recursive: true });

// ── 二进制解析（与 lib/pkg-extract.js / scripts/diagnose-scenes.mjs 同一套）──
function lz4Block(src, dstSize) {
  const dst = new Uint8Array(dstSize);
  let ip = 0, op = 0;
  while (ip < src.length) {
    const t = src[ip++];
    let lit = t >> 4;
    if (lit === 15) { let s = 0; do { s = src[ip++]; lit += s; } while (s === 255); }
    dst.set(src.subarray(ip, ip + lit), op); ip += lit; op += lit;
    if (ip >= src.length) break;
    const off = src[ip] | (src[ip + 1] << 8); ip += 2;
    if (off === 0 || off > op) throw new Error('lz4 offset');
    let ml = t & 15;
    if (ml === 15) { let s = 0; do { s = src[ip++]; ml += s; } while (s === 255); }
    ml += 4;
    for (let i = 0; i < ml; i++) { dst[op] = dst[op - off]; op++; }
  }
  return dst;
}
function parsePkg(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const readStr = () => { const len = view.getInt32(pos, true); pos += 4; const s = data.subarray(pos, pos + len).toString('utf8'); pos += len; return s; };
  const magic = readStr();
  if (!/^PKGV\d{4}$/.test(magic)) throw new Error('bad pkg magic: ' + magic);
  const count = view.getInt32(pos, true); pos += 4;
  const entries = [];
  for (let i = 0; i < count; i++) { const p = readStr(); const off = view.getUint32(pos, true); const len = view.getUint32(pos + 4, true); pos += 8; entries.push({ p, off, len }); }
  const dataStart = pos;
  return entries.map((e) => {
    const abs = dataStart + e.off;
    const orig = view.getUint32(abs, true) + view.getUint32(abs + 4, true) * 4294967296;
    if (orig <= e.len || orig > 2147483647) return { p: e.p, abs, len: e.len, compressed: false };
    return { p: e.p, abs, len: e.len, compressed: true, orig };
  });
}
function readEntry(data, e) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (!e.compressed) return data.subarray(e.abs, e.abs + e.len);
  let r = e.abs + 8, out = new Uint8Array(e.orig), written = 0;
  while (written < e.orig) {
    const u = view.getInt32(r, true), c = view.getInt32(r + 4, true); r += 8;
    out.set(lz4Block(data.subarray(r, r + c), u), written); r += c; written += u;
  }
  return out;
}

// ── 纹理解码：复用 lib/pkg-extract.js 的 decodeTex（rgba / jpeg / png-pass）──

// ── PNG 编码（零依赖）───────────────────────────────────────────────────────
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 4294967295; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 4294967295) >>> 0; }
function pngChunk(type, data) { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); out.set(data, 8); out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out; }
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgba.copy ? rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4) : Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * stride + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const isPkg = scenePath.toLowerCase().endsWith('.pkg');
let pkgData = null, scene = null, entries = [], read = null, byPath = {};
if (isPkg) {
  pkgData = readFileSync(scenePath);
  entries = parsePkg(pkgData);
  byPath = Object.fromEntries(entries.map((e) => [e.p, e]));
  read = (p) => { const e = byPath[p]; return e ? readEntry(pkgData, e) : null; };
  scene = JSON.parse(Buffer.from(read('scene.json')).toString('utf8'));
} else {
  const dir = scenePath;
  read = (p) => { const f = join(dir, p); return existsSync(f) ? readFileSync(f) : null; };
  scene = JSON.parse(readFileSync(join(dir, 'scene.json'), 'utf8'));
}

const layers = [];
let okCount = 0, failCount = 0;
for (const o of scene.objects || []) {
  const rec = {
    id: o.id, name: o.name, image: o.image, origin: o.origin, size: o.size, scale: o.scale,
    angles: o.angles, alpha: o.alpha ?? 1, brightness: o.brightness ?? 1, color: o.color,
    colorBlendMode: o.colorBlendMode ?? 0, alignment: o.alignment, parallaxDepth: o.parallaxDepth,
    visible: o.visible !== false, imageFile: null, note: '',
  };
  try {
    const model = JSON.parse(Buffer.from(read(o.image)).toString('utf8'));
    const mat = JSON.parse(Buffer.from(read(model.material)).toString('utf8'));
    const texNames = (mat.passes || []).flatMap((p) => p.textures || []);
    const texPath = 'materials/' + (texNames[0] || '') + '.tex';
    const raw = read(texPath);
    if (!raw) { rec.note = '纹理缺失 ' + texPath; failCount++; layers.push(rec); continue; }
    const info = parseTex(raw); // 元数据（format/dims）
    let decoded;
    try { decoded = decodeTex(raw); } catch (err) { rec.note = '解码失败: ' + (err && err.message ? err.message : err); failCount++; layers.push(rec); continue; }
    if (!decoded) { rec.note = 'decodeTex 返回空（' + (info ? info.formatName : '非TEX') + '）'; failCount++; layers.push(rec); continue; }
    const safe = String(o.name || o.id).replace(/[^\w\u4e00-\u9fa5-]/g, '_');
    if (decoded.kind === 'jpeg' || decoded.kind === 'png-pass') { rec.imageFile = safe + (decoded.kind === 'jpeg' ? '.jpg' : '.png'); writeFileSync(join(outDir, rec.imageFile), Buffer.from(decoded.bytes)); }
    else { rec.imageFile = safe + '.png'; writeFileSync(join(outDir, rec.imageFile), encodePng(decoded.width, decoded.height, decoded.rgba)); rec._rgba = decoded.rgba; rec._w = decoded.width; rec._h = decoded.height; }
    rec.note = (info ? info.formatName : '?') + ' ' + decoded.width + 'x' + decoded.height;
    okCount++;
  } catch (err) {
    rec.note = '解析失败: ' + (err && err.message ? err.message : err);
    failCount++;
  }
  layers.push(rec);
}

writeFileSync(join(outDir, 'layers.json'), JSON.stringify({
  scene: basename(dirname(scenePath)), camera: scene.camera, general: scene.general,
  canvas: scene.general && scene.general.orthogonalprojection ? { w: scene.general.orthogonalprojection.width, h: scene.general.orthogonalprojection.height } : null,
  layers: layers.map(({ _rgba, _w, _h, ...rest }) => rest),
}, null, 2));

// ── Node 端合成（验证图层叠放；纯 rgba 合成，alpha 用 src-over）──────────────
const cw = (scene.general && scene.general.orthogonalprojection && scene.general.orthogonalprojection.width) || 3840;
const ch = (scene.general && scene.general.orthogonalprojection && scene.general.orthogonalprojection.height) || 2160;
const comp = new Uint8Array(cw * ch * 4);
function blendSrcOver(dst, src, x0, y0, w, h, alpha) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x0 + x, dy = y0 + y;
    if (dx < 0 || dy < 0 || dx >= cw || dy >= ch) continue;
    const si = (y * w + x) * 4, di = (dy * cw + dx) * 4;
    const a = (src[si + 3] / 255) * alpha;
    if (a <= 0) continue;
    const ia = 1 - a;
    dst[di] = (src[si] * a + dst[di] * ia) | 0;
    dst[di + 1] = (src[si + 1] * a + dst[di + 1] * ia) | 0;
    dst[di + 2] = (src[si + 2] * a + dst[di + 2] * ia) | 0;
    dst[di + 3] = 255;
  }
}
let composed = 0;
for (const l of layers) {
  if (!l._rgba) continue;
  const parseV3 = (s) => { const p = (s || '').split(/\s+/).map(Number); return p; };
  const origin = parseV3(l.origin), size = parseV3(l.size), scale = parseV3(l.scale);
  const sx = (scale[0] || 1), sy = (scale[1] || 1);
  const dw = Math.round((size[0] || l._w) * sx), dh = Math.round((size[1] || l._h) * sy);
  // 逐行缩放采样到目标尺寸（简单双线性近似：最近邻）
  for (let ty = 0; ty < dh; ty++) for (let tx = 0; tx < dw; tx++) {
    const sx0 = Math.min(l._w - 1, (tx / dw) * l._w | 0);
    const sy0 = Math.min(l._h - 1, (ty / dh) * l._h | 0);
    // 单像素直接拷贝到临时行缓冲，再整体 blend（简化：直接逐像素 blend）
    const si = (sy0 * l._w + sx0) * 4;
    const dx = Math.round(origin[0] - dw / 2 + tx), dy = Math.round(origin[1] - dh / 2 + ty);
    if (dx < 0 || dy < 0 || dx >= cw || dy >= ch) continue;
    const di = (dy * cw + dx) * 4;
    const a = (l._rgba[si + 3] / 255) * (l.alpha ?? 1);
    if (a <= 0) continue;
    const ia = 1 - a;
    comp[di] = (l._rgba[si] * a + comp[di] * ia) | 0;
    comp[di + 1] = (l._rgba[si + 1] * a + comp[di + 1] * ia) | 0;
    comp[di + 2] = (l._rgba[si + 2] * a + comp[di + 2] * ia) | 0;
    comp[di + 3] = 255;
  }
  composed++;
}
writeFileSync(join(outDir, 'composite.png'), encodePng(cw, ch, comp));
console.log('合成图:', join(outDir, 'composite.png'), '(' + composed + ' 层)');
// 程序化校验：非空像素占比 + 抽样区域（背景角落 vs 人物中心）
{
  let nonBlack = 0, total = cw * ch;
  for (let i = 0; i < total; i++) if (comp[i * 4] + comp[i * 4 + 1] + comp[i * 4 + 2] > 12) nonBlack++;
  const px = (x, y) => { const i = (y * cw + x) * 4; return [comp[i], comp[i + 1], comp[i + 2]]; };
  console.log('非空像素: ' + (100 * nonBlack / total).toFixed(1) + '%');
  console.log('背景角落(200,200):', px(200, 200).join(','));
  console.log('画面中心(1920,1080):', px(1920, 1080).join(','));
  console.log('人物上半身(2115,900):', px(2115, 900).join(','));
  console.log('伞区域(3430,420):', px(3430, 420).join(','));
}

console.log('输出目录:', outDir);
console.log('对象数:', layers.length, '| 成功解码:', okCount, '| 失败:', failCount);
console.log('--- 各图层:');
for (const l of layers) console.log(String(l.id).padStart(3), (l.name || '').padEnd(10), (l.imageFile || '—').padEnd(18), l.note, l.visible ? '' : '(隐藏)');
