import fs from 'fs';
import { parseTex, decodeTex } from 'file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js';

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
const info = parseTex(read('materials/人物.tex'));
const dec = decodeTex(read('materials/人物.tex'));
const w = info.width, h = info.height, srcW = dec.width;
const tdata = dec.rgba;

// 检测多帧：把贴图分成 2x2 象限、3x3、4x4，比较各象限的内容是否"相似角色"
// 方法：检查每象限的内容包围盒 + 内容量
function quadContent(x0, x1, y0, y1) {
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, cnt = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      if (tdata[(y * srcW + x) * 4 + 3] > 10) {
        cnt++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { cnt, box: cnt ? [minX, maxX, minY, maxY] : null };
}

console.log('贴图', w + 'x' + h);
console.log('\n2x2 象限内容:');
for (let gy = 0; gy < 2; gy++) {
  const row = [];
  for (let gx = 0; gx < 2; gx++) {
    const q = quadContent((w * gx) / 2, (w * (gx + 1)) / 2, (h * gy) / 2, (h * (gy + 1)) / 2);
    row.push('Q' + gx + ',' + gy + ': px=' + q.cnt + (q.box ? ' box[' + q.box.join(',') + ']' : ''));
  }
  console.log('  ' + row.join('  '));
}
console.log('\n3x3 象限内容:');
for (let gy = 0; gy < 3; gy++) {
  const row = [];
  for (let gx = 0; gx < 3; gx++) {
    const q = quadContent((w * gx) / 3, (w * (gx + 1)) / 3, (h * gy) / 3, (h * (gy + 1)) / 3);
    row.push('Q' + gx + ',' + gy + ':' + q.cnt + (q.box ? '[' + (q.box[1] - q.box[0]) + 'x' + (q.box[3] - q.box[2]) + ']' : ''));
  }
  console.log('  ' + row.join('  '));
}
