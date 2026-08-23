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
const tex = decodeTex(read('materials/人物.tex'));
const { width: w, height: h, rgba } = tex;
console.log('人物.tex:', w + 'x' + h);

// ASCII 可视化：每 32px 采样一格，字符按内容密度
console.log('\n贴图内容轮廓（每 32px 一格，#=内容密集）:');
const stepX = 32, stepY = 32;
const cols = Math.ceil(w / stepX), rows = Math.ceil(h / stepY);
const grid = [];
for (let gy = 0; gy < rows; gy++) {
  let row = '';
  for (let gx = 0; gx < cols; gx++) {
    let cnt = 0, total = 0;
    for (let y = gy * stepY; y < Math.min(h, (gy + 1) * stepY); y += 4) {
      for (let x = gx * stepX; x < Math.min(w, (gx + 1) * stepX); x += 4) {
        total++;
        if (rgba[(y * w + x) * 4 + 3] > 10) cnt++;
      }
    }
    const r = cnt / total;
    row += r > 0.5 ? '#' : r > 0.2 ? '*' : r > 0.05 ? '+' : r > 0.005 ? '.' : ' ';
  }
  grid.push(row);
}
// 打印中间部分（跳过全空行）
let printed = 0;
for (let i = 0; i < grid.length; i++) {
  if (grid[i].trim().length === 0 && printed === 0) continue;
  if (printed >= 60) break;
  console.log(grid[i]);
  printed++;
}
