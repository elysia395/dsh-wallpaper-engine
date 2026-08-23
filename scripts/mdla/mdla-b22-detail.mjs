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
const DATA2 = mdla + 254324;
const BLOCK = 601;
function decodeFrame(b, f) {
  const rot = (2 * b) % 9;
  const o = DATA2 + (b * BLOCK + f) * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// B22 各关键区间
console.log('=== B22 f=0..12 ===');
for (let f = 0; f <= 12; f++) {
  const un = decodeFrame(22, f);
  console.log(`  f=${String(f).padStart(3)}: pos=(${un[0].toFixed(2)},${un[1].toFixed(2)}) rot=(${un[3].toFixed(4)},${un[4].toFixed(4)},${un[5].toFixed(4)})`);
}
console.log('\n=== B22 f=120..140 ===');
for (let f = 120; f <= 140; f++) {
  const un = decodeFrame(22, f);
  console.log(`  f=${String(f).padStart(3)}: pos=(${un[0].toFixed(2)},${un[1].toFixed(2)}) rot=(${un[3].toFixed(4)},${un[4].toFixed(4)},${un[5].toFixed(4)})`);
}
console.log('\n=== B22 f=580..600 ===');
for (let f = 580; f <= 600; f++) {
  const un = decodeFrame(22, f);
  console.log(`  f=${String(f).padStart(3)}: pos=(${un[0].toFixed(2)},${un[1].toFixed(2)}) rot=(${un[3].toFixed(4)},${un[4].toFixed(4)},${un[5].toFixed(4)})`);
}

// 检查: 动画 2 中 B0 是否真的运动 (之前说最后变化 f=600)
console.log('\n=== B0 f=0,1,2,3,10,300,599,600 ===');
for (const f of [0, 1, 2, 3, 10, 300, 598, 599, 600]) {
  const un = decodeFrame(0, f);
  console.log(`  f=${String(f).padStart(3)}: pos=(${un[0].toFixed(3)},${un[1].toFixed(3)},${un[2].toFixed(3)}) rot=(${un[3].toFixed(4)},${un[4].toFixed(4)},${un[5].toFixed(4)}) scale=(${un[6].toFixed(3)},${un[7].toFixed(3)},${un[8].toFixed(3)})`);
}
