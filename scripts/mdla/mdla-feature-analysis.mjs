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
const mdla = 79842;
const DATA1 = mdla + 63;
const DATA2 = mdla + 254324;
function decode(b, f, base, blk) {
  const rot = (2 * b) % 9;
  const o = base + (b * blk + f) * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// 动画1 B4: 摆动周期和幅度 (呼吸 = 缓慢平滑, ~2秒周期)
// 133帧 @ 0.76 rate → 133/0.76 = 175 帧? 帧率 60fps → 2.9 秒周期
// 动画1 B4 位移从 484.9 到 451.2 = 33.7px 水平, 17.6px 垂直
console.log('=== 动画1 B4: 水平位移幅度 33.7px (呼吸/身体摆动?) ===');
console.log('B4 是 B3 的子骨, B3 在头部区域 (-86,249)');
console.log('B4-B20 共 17 个子骨 = 头部装饰/刘海?');

// 检查 B21-B29 (长发) 在动画 1 中是否动
console.log('\n=== 动画1 B21-B29 (长发区) 是否有运动 ===');
for (let b = 21; b <= 29; b++) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minR = 1e9, maxR = -1e9;
  for (let f = 1; f < 133; f++) {
    const un = decode(b, f, DATA1, 133);
    if (!isFinite(un[0])) continue;
    if (un[0] < minX) minX = un[0]; if (un[0] > maxX) maxX = un[0];
    if (un[1] < minY) minY = un[1]; if (un[1] > maxY) maxY = un[1];
    const r = Math.abs(un[3]) + Math.abs(un[4]) + Math.abs(un[5]);
    if (r < minR) minR = r; if (r > maxR) maxR = r;
  }
  const dx = maxX - minX, dy = maxY - minY, dr = maxR - minR;
  if (dx > 0.2 || dy > 0.2 || dr > 0.01) console.log(`  B${b}: Δpos=(${dx.toFixed(1)},${dy.toFixed(1)}) Δrot=${dr.toFixed(3)}`);
}

// 动画2 B22 摆动: 幅度和周期
console.log('\n=== 动画2 B22: rot.z 摆动 (头发飘动) ===');
console.log('f=5..125, rot.z 0 → 0.187 → 0 (摆动 120 帧 = 2秒 @60fps)');

// 检查动画2 中是否有快速/高频骨骼 (眨眼候选)
console.log('\n=== 动画2 中高频骨骼 (f=1..600 多次变化) ===');
for (let b = 0; b < 53; b++) {
  let changes = 0;
  let prev = null;
  for (let f = 1; f < 601; f++) {
    const un = decode(b, f, DATA2, 601);
    if (!isFinite(un[0])) break;
    if (prev) {
      const d = Math.abs(un[0]-prev[0]) + Math.abs(un[1]-prev[1]) + Math.abs(un[3]-prev[3]) + Math.abs(un[4]-prev[4]) + Math.abs(un[5]-prev[5]);
      if (d > 0.05) changes++;
    }
    prev = un;
  }
  if (changes > 5) console.log(`  B${b}: ${changes} 次变化`);
}
