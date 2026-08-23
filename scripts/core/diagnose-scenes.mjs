/**
 * diagnose-scenes.mjs — mass-diagnose every local Scene wallpaper: what the
 * current extractor picks vs. the full texture inventory, with pixel-level
 * quality stats (grayscale ratio, normal-map signature, flatness) so we can
 * tell "correct art" apart from "gray mask" / "meaningless texture".
 *
 * Reads only; writes a TSV report to <root>/scene-diagnosis.tsv.
 *
 * Usage: node scripts/diagnose-scenes.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WE_APPID = '431960';
const FMT = { 0: 'RGBA8888', 1: 'RGB888', 2: 'RGB565', 4: 'DXT5', 6: 'DXT3', 7: 'DXT1', 8: 'RG88', 9: 'R8', 10: 'RG1616F', 11: 'R16F', 12: 'BC7', 13: 'RGBA1010102', 14: 'RGBA16161616F', 15: 'RGB161616F' };

// ── Binary helpers (same parsing as lib/pkg-extract.js) ──────────────────────
function lz4Block(src, dstSize) {
  const dst = new Uint8Array(dstSize);
  let ip = 0, op = 0;
  while (ip < src.length) {
    const token = src[ip++];
    let lit = token >> 4;
    if (lit === 15) { let s = 0; do { s = src[ip++]; lit += s; } while (s === 255); }
    if (ip + lit > src.length || op + lit > dstSize) throw new Error('lz4 bounds');
    dst.set(src.subarray(ip, ip + lit), op); ip += lit; op += lit;
    if (ip >= src.length) break;
    const offset = src[ip] | (src[ip + 1] << 8); ip += 2;
    if (offset === 0 || offset > op) throw new Error('lz4 offset');
    let mlen = token & 15;
    if (mlen === 15) { let s = 0; do { s = src[ip++]; mlen += s; } while (s === 255); }
    mlen += 4;
    for (let i = 0; i < mlen; i++) { dst[op] = dst[op - offset]; op++; }
  }
  return dst;
}
function parsePkg(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const readStr = () => { const len = view.getInt32(pos, true); pos += 4; const s = data.subarray(pos, pos + len).toString('utf8'); pos += len; return s; };
  const magic = readStr();
  if (!/^PKGV\d{4}$/.test(magic)) throw new Error('bad pkg magic');
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
function texMeta(bytes) {
  const b = bytes;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let q = 0;
  const nstr = () => { let e2 = q; while (v.getUint8(e2) !== 0) e2++; const s = b.subarray(q, e2).toString('utf8'); q = e2 + 1; return s; };
  const m1 = nstr(); if (!m1.startsWith('TEXV')) return null;
  nstr();
  const format = v.getInt32(q, true); q += 4;
  const flags = v.getInt32(q, true); q += 4;
  const tw = v.getInt32(q, true), th = v.getInt32(q, true); q += 8;
  const iw = v.getInt32(q, true), ih = v.getInt32(q, true); q += 8;
  q += 4;
  const cm = nstr(); const cver = /TEXB000(\d)/.exec(cm) ? Number(cm[6]) : 0;
  const imageCount = v.getInt32(q, true); q += 4;
  if (cver === 3) q += 4;
  else if (cver === 4) { const ff = v.getInt32(q, true); q += 4; const isMp4 = v.getInt32(q, true); q += 4; if (!(ff === -1 && isMp4 === 1)) cver = 3; }
  const mipCount = v.getInt32(q, true); q += 4;
  let m0 = null;
  for (let j = 0; j < mipCount; j++) {
    if (cver === 4) { q += 4; q += 4; q += nstr().length + 1; q += 4; }
    const w = v.getInt32(q, true), h = v.getInt32(q, true); q += 8;
    const isLz4 = v.getInt32(q, true); q += 4;
    const dc = v.getInt32(q, true); q += 4;
    const sl = v.getInt32(q, true); q += 4;
    if (j === 0) m0 = { w, h, isLz4, dc, sl, data: b.subarray(q, q + sl) };
    q += sl;
  }
  const jpeg = m0 && m0.data.length >= 2 && m0.data[0] === 0xff && m0.data[1] === 0xd8;
  return { format, formatName: FMT[format] ?? ('fmt' + format), tex: tw + 'x' + th, img: iw + 'x' + ih, jpeg, m0 };
}
// JPEG SOF dims
function jpegDims(b) {
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xd8) { p += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { w: ((b[p + 7] << 8) | b[p + 8]) & 0xffff, h: ((b[p + 5] << 8) | b[p + 6]) & 0xffff };
    }
    const len = ((b[p + 2] << 8) | b[p + 3]) & 0xffff;
    if (len < 2) return null;
    p += 2 + len;
  }
  return null;
}
// Decode mip0 to sampled RGBA for JPEG or raw RGBA8888/R8/RG88 (sample-based; full decode for RGBA only when small).
function samplePixels(bytes, meta, wantSamples) {
  if (!meta || !meta.m0) return null;
  const m0 = meta.m0;
  const w = m0.w, h = m0.h;
  if (w <= 0 || h <= 0 || w > 16384 || h > 16384) return null;
  const total = w * h;
  const samples = Math.min(wantSamples, total);
  const picks = [];
  for (let i = 0; i < samples; i++) picks.push(Math.floor(Math.random() * total));
  if (meta.jpeg) {
    // decode the whole JPEG via a tiny decoder is heavy; use SOF dims + skip pixel check
    const d = jpegDims(m0.data);
    return { jpeg: true, w: d ? d.w : w, h: d ? d.h : h, samples: [] };
  }
  const fmt = meta.format;
  let px = null;
  if (fmt === 0) { // RGBA8888
    if (m0.data.length >= total * 4) px = { rgba: m0.data.subarray(0, total * 4), bpp: 4 };
    else {
      // maybe dims mismatch — try derive from length
      const pxLen = m0.data.length / 4;
      const w2 = Math.floor(Math.sqrt(pxLen)); if (w2 * w2 === pxLen) px = { rgba: m0.data, bpp: 4 };
    }
  } else if (fmt === 9) { // R8
    if (m0.data.length >= total) px = { rgba: m0.data, bpp: 1 };
  } else if (fmt === 8) { // RG88
    if (m0.data.length >= total * 2) px = { rgba: m0.data, bpp: 2 };
  }
  if (!px) return { jpeg: false, w, h, undecodable: true, samples: [] };
  const out = [];
  for (const idx of picks) {
    const o = idx * px.bpp;
    if (px.bpp === 4) out.push([px.rgba[o], px.rgba[o + 1], px.rgba[o + 2]]);
    else if (px.bpp === 1) out.push([px.rgba[o], px.rgba[o], px.rgba[o]]);
    else out.push([px.rgba[o], px.rgba[o + 1], 0]);
  }
  return { jpeg: false, w, h, samples: out };
}
function classify(sample) {
  if (!sample) return 'no-sample';
  if (sample.jpeg) return 'jpeg';
  if (sample.undecodable) return 'undecodable';
  const n = sample.samples.length;
  if (n === 0) return 'no-pixels';
  let gray = 0, colorful = 0, flat = 0;
  let sr = 0, sg = 0, sb = 0;
  for (const [r, g, b] of sample.samples) {
    sr += r; sg += g; sb += b;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread <= 24) gray++; else colorful++;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  let varSum = 0;
  for (const [r, g, b] of sample.samples) varSum += Math.abs(r - mr) + Math.abs(g - mg) + Math.abs(b - mb);
  const meanVar = varSum / (n * 3);
  const grayRatio = gray / n;
  const normalLike = mr > 90 && mr < 170 && mg > 90 && mg < 170 && mb > 180 && meanVar > 8 && grayRatio < 0.6;
  const kind = grayRatio > 0.75 ? 'GRAY' : normalLike ? 'NORMAL?' : meanVar < 4 ? 'FLAT' : 'color';
  return { kind, grayRatio: +grayRatio.toFixed(2), avg: [Math.round(mr), Math.round(mg), Math.round(mb)], meanVar: +meanVar.toFixed(1), n };
}

// ── Discovery ────────────────────────────────────────────────────────────────
function steamRoots() {
  const out = [];
  const probes = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam', 'D:\\SteamLibrary', 'E:\\SteamLibrary'];
  for (const p of probes) { if (existsSync(p)) out.push(p); }
  return out;
}
function findSceneProjects() {
  const dirs = [];
  for (const root of steamRoots()) {
    const ws = join(root, 'steamapps', 'workshop', 'content', WE_APPID);
    if (existsSync(ws)) { try { for (const n of readdirSync(ws)) { const d = join(ws, n); if (statSync(d).isDirectory()) dirs.push(d); } } catch {} }
    const we = join(root, 'steamapps', 'common', 'wallpaper_engine');
    if (existsSync(we)) { for (const sub of ['projects\\defaultprojects', 'projects\\myprojects']) { const p = join(we, sub); if (existsSync(p)) { try { for (const n of readdirSync(p)) { const d = join(p, n); if (statSync(d).isDirectory()) dirs.push(d); } } catch {} } } }
  }
  return [...new Set(dirs)];
}
function resolveMain(dir) {
  const candidates = ['scene.pkg', 'scene.json'];
  for (const c of candidates) { try { if (statSync(join(dir, c)).isFile()) return c; } catch {} }
  let pkgs = [];
  try { pkgs = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.pkg')); } catch {}
  return pkgs.length === 1 ? pkgs[0] : null;
}

// Decode a full PNG (filter types 0-4) and return sampled pixels.
// Handles 8-bit color types 2 (RGB) and 6 (RGBA) — WE embedded PNGs are RGB.
function pngSample(bytes, want) {
  const b = Buffer.from(bytes);
  if (!(b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG')) return null;
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const ct = b[25];
  const channels = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (w <= 0 || h <= 0 || w > 16384 || h > 16384 || !channels) return null;
  const idats = [];
  let iendP = -1, p = 8;
  while (p < b.length) {
    if (p + 8 > b.length) return null;
    const len = b.readUInt32BE(p); const t = b.toString('ascii', p + 4, p + 8);
    if (p + 12 + len > b.length) return null;
    if (t === 'IDAT') idats.push(b.subarray(p + 8, p + 8 + len));
    if (t === 'IEND') { iendP = p; break; }
    p += 12 + len;
  }
  if (!idats.length || iendP < 0) return null;
  let raw;
  try { raw = Buffer.from(inflateSync(Buffer.concat(idats))); } catch { return null; }
  const stride = w * channels + 1;
  if (raw.length < stride * h) return null;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride];
    const line = raw.subarray(y * stride + 1, (y + 1) * stride);
    for (let x = 0; x < w * channels; x++) {
      const a = x >= channels ? out[y * w * 4 + x - channels] : 0;
      const pr = y > 0 ? out[(y - 1) * w * 4 + x] : 0;
      const pc = y > 0 && x >= channels ? out[(y - 1) * w * 4 + x - channels] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + pr) & 255;
      else if (f === 3) v = (v + ((a + pr) >> 1)) & 255;
      else if (f === 4) { const q = a + pr - pc, pa = Math.abs(q - a), pb = Math.abs(q - pr), pcv = Math.abs(q - pc); v = (v + (pa <= pb && pa <= pcv ? a : pb <= pcv ? pr : pc)) & 255; }
      out[y * w * 4 + x] = v;
    }
  }
  const total = w * h;
  const n = Math.min(want, total);
  const samples = [];
  for (let i = 0; i < n; i++) { const o = Math.floor(Math.random() * total) * 4; samples.push([out[o], out[o + 1], out[o + 2]]); }
  return { w, h, samples };
}
function classifySamples(samples) {
  const n = samples.length;
  if (!n) return 'no-pixels';
  let gray = 0, sr = 0, sg = 0, sb = 0;
  for (const [r, g, b] of samples) { sr += r; sg += g; sb += b; if (Math.max(r, g, b) - Math.min(r, g, b) <= 24) gray++; }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  let v = 0;
  for (const [r, g, b] of samples) v += Math.abs(r - mr) + Math.abs(g - mg) + Math.abs(b - mb);
  const mv = v / (n * 3);
  const grayRatio = gray / n;
  const normalLike = mr > 90 && mr < 175 && mg > 90 && mg < 175 && mb > 180 && mv > 8;
  return { kind: grayRatio > 0.75 ? 'GRAY' : normalLike ? 'NORMAL?' : mv < 4 ? 'FLAT' : 'color', grayRatio: +grayRatio.toFixed(2), avg: [Math.round(mr), Math.round(mg), Math.round(mb)], var: +mv.toFixed(1) };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const projects = findSceneProjects();
console.log('scene projects found:', projects.length);
const rows = [];
let okCount = 0, badCount = 0, jpegCount = 0, pngCount = 0, errCount = 0, unverifiable = 0, previewCount = 0;
for (const dir of projects) {
  const id = dir.split(/[\\/]/).pop();
  const main = resolveMain(dir);
  if (!main) { rows.push([id, 'no-main', '', '', '', '', '', '', '']); errCount++; continue; }
  const abs = join(dir, main);
  const mod = await import(pathToFileURL(resolve(root, 'lib', 'pkg-extract.js')).href);
  try {
    const frame = main.toLowerCase().endsWith('.json')
      ? mod.extractSceneMainImageFromDir(dir)
      : mod.extractSceneMainImage(new Uint8Array(readFileSync(abs)));
    const mime = frame.mime;
    if (mime === 'image/jpeg') jpegCount++;
    else pngCount++;
    let verdict = 'jpeg-art';
    let outStats = '';
    if (mime === 'image/png') {
      const px = pngSample(frame.bytes, 1500);
      if (px) {
        const cls = classifySamples(px.samples);
        verdict = cls.kind;
        outStats = 'avg=' + cls.avg.join(',') + ' gray=' + cls.grayRatio + ' var=' + cls.var;
      } else { verdict = 'unverifiable'; unverifiable++; }
    } else if (mime === 'image/jpeg') jpegCount = jpegCount; // counted above
    const good = verdict === 'color' || verdict === 'jpeg-art';
    if (good) okCount++; else badCount++;
    // texture inventory (pkg only)
    let inventory = [];
    if (main.toLowerCase().endsWith('.pkg')) {
      const data = readFileSync(abs);
      const entries = parsePkg(data);
      for (const e of entries) {
        if (!e.p.toLowerCase().endsWith('.tex')) continue;
        try {
          const meta = texMeta(readEntry(data, e));
          if (meta) inventory.push({ p: e.p, ...meta });
        } catch {}
      }
    }
    const largest = inventory.slice().sort((a, b) => (a.m0 ? a.m0.w * a.m0.h : 0) - (b.m0 ? b.m0.w * b.m0.h : 0)).reverse()[0];
    const jpegs = inventory.filter((t) => t.jpeg);
    const pickInfo = inventory.find((t) => t.p.toLowerCase() === String(frame.texturePath || '').toLowerCase()) || null;
    rows.push([id, 'OK:' + (good ? 'yes' : 'NO'), mime, frame.width + 'x' + frame.height,
      (frame.texturePath || ''),
      'jpegs:' + jpegs.length + '/tex:' + inventory.length,
      'largest:' + (largest ? largest.p + ' ' + largest.formatName + ' ' + largest.img + (largest.jpeg ? ' JPEG' : '') : '-'),
      'grays:' + inventory.filter((t) => t.sample && t.sample.kind === 'GRAY').length,
      'verdict:' + verdict + (outStats ? ' ' + outStats : '')]);
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('frame rejected')) {
      rows.push([id, 'PREVIEW-FALLBACK', '', '', msg.slice(0, 90), '', '', '', '']); // quality gate → client shows preview.jpg (expected)
      previewCount++;
    } else {
      rows.push([id, 'ERR', '', '', msg.slice(0, 90), '', '', '', '']);
      errCount++;
    }
  }
}
const out = ['id\tresult\tmime\tdims\tpicked\tinventory\tlargest\tgrays\tverdict'];
for (const r of rows) out.push(r.map((c) => String(c).replace(/\t/g, ' ')).join('\t'));
const report = join(root, 'scene-diagnosis.tsv');
writeFileSync(report, out.join('\n'), 'utf8');
console.log('report written:', report);
console.log(`ok=${okCount} bad=${badCount} preview-fallback=${previewCount} err=${errCount} unverifiable=${unverifiable} (jpeg=${jpegCount} png=${pngCount})`);
console.log('\n=== BAD (GRAY/NORMAL/FLAT) rows ===');
for (const r of rows) {
  const res = String(r[1]);
  if (res.includes('NO')) console.log(r.join(' | '));
}
console.log('\n=== REAL ERR rows ===');
for (const r of rows) {
  if (String(r[1]).includes('ERR')) console.log(r.join(' | '));
}
