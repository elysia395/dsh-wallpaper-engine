import fs from 'fs';
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
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdla = 79842, mdle = 1481325;
const DATA1 = mdla + 63;

function decodeHead(b, f) {
  const rot = (2 * b) % 9;
  const o = DATA1 + (b * 133 + f) * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// HEAD 各骨骼幅度 (f=1..132, 排除 f=0 特殊帧)
console.log('=== HEAD 各骨骼真实幅度 (f=1..132) ===');
const results = [];
for (let b = 0; b < 53; b++) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  let minR = 1e9, maxR = -1e9;
  for (let f = 1; f < 133; f++) {
    const un = decodeHead(b, f);
    if (!isFinite(un[0])) continue;
    if (un[0] < minX) minX = un[0]; if (un[0] > maxX) maxX = un[0];
    if (un[1] < minY) minY = un[1]; if (un[1] > maxY) maxY = un[1];
    const r = Math.abs(un[3]) + Math.abs(un[4]) + Math.abs(un[5]);
    if (r < minR) minR = r; if (r > maxR) maxR = r;
  }
  const dx = maxX - minX, dy = maxY - minY, dr = maxR - minR;
  results.push({ b, dx, dy, dr });
}
// 只显示真正有幅度 (>0.1) 的
const real = results.filter(r => r.dx > 0.1 || r.dy > 0.1 || r.dr > 0.01);
console.log('HEAD 有真实幅度骨骼:', real.length);
for (const r of real) {
  console.log(`  B${String(r.b).padStart(2)}: Δpos=(${r.dx.toFixed(1)},${r.dy.toFixed(1)}) Δrot=${r.dr.toFixed(3)}`);
}

// 动画 2 尾部 451 字节: 检查是否有第 3 个动画头
console.log('\n=== 动画2 尾部 451 字节检查 ===');
const tailStart = mdla + 1401032;
console.log('尾部 @', 1401032, '字节:');
const seg = buf.slice(tailStart, mdla + 1401483);
const ascii = seg.toString('ascii');
// 找可打印字符串
const strs = ascii.match(/[\x20-\x7e]{4,}/g);
console.log('可打印字符串:', strs ? strs.join(' | ') : '无');
// 找 "动画" UTF-8
const animIdx = seg.indexOf(Buffer.from('动画', 'utf8'));
console.log('"动画" 在尾部偏移:', animIdx);
const loopIdx = seg.indexOf(Buffer.from('loop'));
console.log('"loop" 在尾部偏移:', loopIdx);
if (animIdx >= 0) {
  console.log('尾部 "动画" 上下文:', seg.slice(animIdx - 4, animIdx + 20).toString('hex'));
}
