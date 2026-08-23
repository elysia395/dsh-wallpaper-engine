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

const DATA1 = mdla + 63;      // 动画1
const DATA2 = mdla + 254324;  // 动画2
function decode(b, f, base, blk) {
  const rot = (2 * b) % 9;
  const o = base + (b * blk + f) * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// 动画1 中 B4-B20 (头部区域) 的曲线 - 找眨眼/呼吸特征
console.log('=== 动画1 B4 完整 pos.y 曲线 (每 3 帧) ===');
for (let f = 0; f < 133; f += 3) {
  const un = decode(4, f, DATA1, 133);
  console.log(`  f=${String(f).padStart(3)}: pos=(${un[0].toFixed(1)},${un[1].toFixed(1)}) rot=(${un[3].toFixed(3)},${un[4].toFixed(3)},${un[5].toFixed(3)})`);
}

// 动画1 其他骨骼检查
console.log('\n=== 动画1 B5-B20 是否有运动 (f=1..132) ===');
for (let b = 5; b <= 20; b++) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let f = 1; f < 133; f++) {
    const un = decode(b, f, DATA1, 133);
    if (!isFinite(un[0])) continue;
    if (un[0] < minX) minX = un[0]; if (un[0] > maxX) maxX = un[0];
    if (un[1] < minY) minY = un[1]; if (un[1] > maxY) maxY = un[1];
  }
  const dx = maxX - minX, dy = maxY - minY;
  if (dx > 0.2 || dy > 0.2) console.log(`  B${b}: Δpos=(${dx.toFixed(1)},${dy.toFixed(1)})`);
}

// 动画1 B4 速度分析 (眨眼特征: 快速向下再向上)
console.log('\n=== 动画1 B4 pos.y 逐帧速度 ===');
let prevY = null;
for (let f = 1; f < 133; f++) {
  const un = decode(4, f, DATA1, 133);
  if (prevY !== null) {
    const dy = un[1] - prevY;
    if (Math.abs(dy) > 0.5) console.log(`  f=${f}: Δy=${dy.toFixed(2)}`);
  }
  prevY = un[1];
}
