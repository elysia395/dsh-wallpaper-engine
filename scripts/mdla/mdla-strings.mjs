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

// 精确解析 MDLA 头部（逐字节）
console.log('=== MDLA 完整头部（前 200 字节）===');
for (let off = 0; off < 200; off += 16) {
  const bytes = Buffer.from(buf.slice(mdla + off, mdla + off + 16)).toString('hex');
  const ascii = buf.toString('ascii', mdla + off, mdla + off + 16).replace(/[^\x20-\x7e]/g, '.');
  const f0 = dv2.getFloat32(mdla + off, true);
  const f1 = dv2.getFloat32(mdla + off + 4, true);
  const f2 = dv2.getFloat32(mdla + off + 8, true);
  const f3 = dv2.getFloat32(mdla + off + 12, true);
  console.log('@' + String(off).padStart(3) + ': ' + bytes + '  ' + ascii + '  f(' + f0.toFixed(1) + ',' + f1.toFixed(1) + ',' + f2.toFixed(1) + ',' + f3.toFixed(1) + ')');
}

// 关键: 找"骨骼名称"表。动画通常有骨骼名（ASCII 字符串）
console.log('\nMDLA 中 ASCII 字符串（>3 字符）:');
let strings = [];
for (let i = mdla + 8; i < mdle - 4; i++) {
  if (buf[i] >= 32 && buf[i] < 127) {
    let e = i;
    while (e < mdle && buf[e] >= 32 && buf[e] < 127) e++;
    if (e - i >= 3) {
      strings.push([i - mdla, buf.toString('ascii', i, e)]);
      i = e;
    }
  }
}
for (const [o, s] of strings.slice(0, 40)) console.log('  @' + o + ': "' + s + '"');
console.log('共', strings.length, '个字符串');
