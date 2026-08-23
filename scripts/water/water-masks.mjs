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
// 水对象 mask 纹理 (限制水波区域)
const scene = read('scene.json').toString('utf8');
// 提取水对象的 textures (mask)
const lines = scene.split('\n');
let inWater = false;
const masks = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('"image" : "models/水.json"')) { inWater = true; break; }
  if (inWater && lines[i].includes('"textures"')) {
    const m = lines[i].match(/"masks\/([^"]+)"/);
    if (m) masks.push(m[1]);
  }
}
// 重新提取 (上面逻辑有 bug, 用完整段)
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('"image" : "models/水.json"')) {
    // 向前找 effects
    let j = i - 1;
    const block = lines.slice(Math.max(0, i - 200), i).join('\n');
    const maskMatches = [...block.matchAll(/"masks\/([^"]+)"/g)];
    for (const m of maskMatches) masks.push(m[1]);
    break;
  }
}
console.log('水对象 mask 纹理:', [...new Set(masks)].join(', '));
