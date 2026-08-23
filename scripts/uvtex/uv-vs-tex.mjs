import fs from 'fs';
import { decodeTex } from 'file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js';

const PKG = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';
function readPkg() {
  const data = fs.readFileSync(PKG);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const rstr = () => { const len = dv.getInt32(pos, true); pos += 4; const s = data.toString('utf8', pos, pos + len); pos += len; return s; };
  rstr(); const count = dv.getInt32(pos, true); pos += 4;
  const entries = [];
  for (let i = 0; i < count; i++) { const p = rstr(); const off = dv.getUint32(pos, true); const len = dv.getUint32(pos + 4, true); pos += 8; entries.push({ p, off, len }); }
  const dataStart = pos;
  const byPath = Object.fromEntries(entries.map((e) => [e.p, e]));
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
  const read = (p) => {
    const e = byPath[p];
    if (!e) return null;
    const abs = dataStart + e.off;
    const seg = data.subarray(abs, abs + e.len);
    const orig = dv.getUint32(abs, true) + dv.getUint32(abs + 4, true) * 4294967296;
    if (orig <= e.len || orig > 2147483647) return seg;
    let r = abs + 8;
    const out = new Uint8Array(orig);
    let written = 0;
    while (written < orig) {
      const u = dv.getInt32(r, true), c = dv.getInt32(r + 4, true);
      r += 8;
      out.set(lz4(data.subarray(r, r + c), u), written);
      r += c; written += u;
    }
    return out;
  };
  return { read };
}

const { read } = readPkg();
const buf = read('models/人物_puppet.mdl');
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const streamStart = 79, stride = 80, vb = 50720;
const vc = vb / stride;

// 统计顶点 UV 分布：8x8 网格，每个格子有多少顶点 UV 落在其中
const grid = Array.from({ length: 8 }, () => new Array(8).fill(0));
const uvList = [];
for (let i = 0; i < vc; i++) {
  const o = streamStart + i * stride;
  const u = dv.getFloat32(o + 72, true);
  const v = dv.getFloat32(o + 76, true);
  uvList.push([u, v]);
  const gx = Math.min(7, Math.max(0, Math.floor(u * 8)));
  const gy = Math.min(7, Math.max(0, Math.floor(v * 8)));
  grid[gy][gx]++;
}
console.log('顶点 UV 分布（8x8，每格顶点数）:');
for (let gy = 0; gy < 8; gy++) {
  console.log('  v' + (gy * 12.5).toFixed(0) + '%: ' + grid[gy].map((n) => String(n).padStart(4)).join(' '));
}

// 贴图对应区域内容对比（8x8 非空）
const tex = decodeTex(read('materials/人物.tex'));
const { width: tw, height: th, rgba } = tex;
console.log('\n贴图内容（8x8，每格非空%）:');
for (let gy = 0; gy < 8; gy++) {
  const cells = [];
  for (let gx = 0; gx < 8; gx++) {
    let cnt = 0, tot = 0;
    const x0 = (tw * gx) / 8 | 0, x1 = (tw * (gx + 1)) / 8 | 0;
    const y0 = (th * gy) / 8 | 0, y1 = (th * (gy + 1)) / 8 | 0;
    for (let y = y0; y < y1; y += 4) {
      for (let x = x0; x < x1; x += 4) {
        tot++;
        if (rgba[(y * tw + x) * 4 + 3] > 10) cnt++;
      }
    }
    cells.push((100 * cnt / tot).toFixed(0));
  }
  console.log('  v' + (gy * 12.5).toFixed(0) + '%: ' + cells.map((s) => s.padStart(4)).join(' '));
}
