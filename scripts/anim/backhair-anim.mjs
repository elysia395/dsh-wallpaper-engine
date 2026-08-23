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
const buf = read('models/发_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdla = 4057, mdle = 32923;
const DATA0 = mdla + 99;
const BLOCK = 133;
const bones = [
  { b: 0, anchor: [1166.0, 198.8] },
  { b: 1, anchor: [-679.5, -393.7] },
  { b: 2, anchor: [-1268.1, -732.2] },
  { b: 3, anchor: [-544.4, -38.2] },
  { b: 4, anchor: [911.2, 552.5] },
  { b: 5, anchor: [-1107.2, -1478.6] },
];
function decodeBone(b, f) {
  const rot = (2 * b) % 9;
  const o = DATA0 + (b * BLOCK + f) * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

console.log('=== 后发各骨骼动画幅度 (f=1..132) ===');
for (let b = 0; b < 6; b++) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, maxR = 0;
  for (let f = 1; f < 133; f++) {
    const un = decodeBone(b, f);
    if (!isFinite(un[0])) continue;
    if (un[0] < minX) minX = un[0]; if (un[0] > maxX) maxX = un[0];
    if (un[1] < minY) minY = un[1]; if (un[1] > maxY) maxY = un[1];
    const r = Math.abs(un[3]) + Math.abs(un[4]) + Math.abs(un[5]);
    if (r > maxR) maxR = r;
  }
  const dx = maxX - minX, dy = maxY - minY;
  console.log(`  B${b} (anchor ${bones[b].anchor[0].toFixed(0)},${bones[b].anchor[1].toFixed(0)}): Δpos=(${dx.toFixed(1)},${dy.toFixed(1)}) maxRot=${maxR.toFixed(3)} ${dx > 1 || dy > 1 || maxR > 0.01 ? '← 动画!' : ''}`);
}

// B5 (最远发丝) 曲线
console.log('\n=== 后发 B5 曲线 (每 5 帧) ===');
for (let f = 0; f < 133; f += 5) {
  const un = decodeBone(5, f);
  console.log(`  f=${String(f).padStart(3)}: pos=(${un[0].toFixed(1)},${un[1].toFixed(1)}) rot=(${un[3].toFixed(3)},${un[4].toFixed(3)},${un[5].toFixed(3)})`);
}
