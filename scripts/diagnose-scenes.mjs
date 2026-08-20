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
import { parsePkg, readPkgEntry, parseTex } from '../lib/pkg-extract.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WE_APPID = '431960';

// ── TEX metadata (thin adapter over lib/pkg-extract.js's parser — the PKG /
//    LZ4 / TEX parsing itself lives in the library, never duplicated here). ──
function texMeta(bytes) {
  try {
    const info = parseTex(bytes);
    if (!info || info.isVideoMp4) return null;
    return {
      format: info.format,
      formatName: info.formatName,
      tex: info.width + 'x' + info.height,
      img: info.width + 'x' + info.height,
      jpeg: info.embedded === 'jpeg',
      m0: { w: info.width, h: info.height },
    };
  } catch { return null; }
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
      const data = new Uint8Array(readFileSync(abs));
      const entries = parsePkg(data);
      for (const e of entries) {
        if (!e.path.toLowerCase().endsWith('.tex')) continue;
        try {
          const meta = texMeta(readPkgEntry(data, e));
          if (meta) inventory.push({ p: e.path, ...meta });
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
      // Grayscale-format textures (R8/RG88) as a rough mask/helper count —
      // pixel-level classification of every inventory texture is out of scope.
      'grays:' + inventory.filter((t) => t.format === 8 || t.format === 9).length,
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
