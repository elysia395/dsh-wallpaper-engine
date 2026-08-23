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
// waterripple.frag 剩余
const ripple = read('shaders/effects/waterripple.frag');
console.log('=== waterripple.frag 全文 ===');
console.log(ripple ? ripple.toString('utf8') : 'null');

// 水对象完整参数 (waterripple 和所有 effect 的 constantshadervalues)
const scene = read('scene.json').toString('utf8');
const lines = scene.split('\n');
console.log('\n=== 水对象 (id=16) 完整 effects 段 ===');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('"id" : 16,') && lines[i-1] && lines[i-1].includes('"image"')) {
    // 已经接近
  }
}
// 找水对象完整块
const idx = scene.indexOf('"image" : "models/水.json"');
// 向前找对象起点
let start = idx;
let depth = 0;
for (let i = idx; i > 0; i--) {
  if (scene[i] === '}') depth++;
  if (scene[i] === '{') { depth--; if (depth < 0) { start = i; break; } }
}
// 向后找对象结束
let end = idx;
depth = 0;
for (let i = idx; i < scene.length; i++) {
  if (scene[i] === '{') depth++;
  if (scene[i] === '}') { depth--; if (depth < 0) { end = i + 1; break; } }
}
console.log(scene.slice(start, end));
