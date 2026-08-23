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
console.log('MDL size:', buf.length);

// 找所有 ASCII 标记
const markers = [];
for (let i = 0; i < buf.length - 8; i++) {
  const s = buf.toString('ascii', i, i + 8);
  if (/^MDL[A-Z0-9]{4}$/.test(s)) markers.push([i, s]);
}
console.log('MDL 标记:', markers.map(([o, s]) => o + ':' + s).join('  '));

// 检查第一个 mesh block 之后（verticesOffset + vertexBytes + 4 + indexBytes）到 MDLS 之间还有什么
const mdlsOffset = markers.find(([o, s]) => s === 'MDLS0004' || s.startsWith('MDLS'))?.[0] ?? -1;
console.log('MDLS offset:', mdlsOffset);

// 检查文件中是否还有第二个 mesh 区域（在 MDLS 之后）
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
// 从 mdlsOffset 之后找 float 顶点簇
console.log('\nMDLS 之后内容（前 200 字节 hex）:');
console.log(Buffer.from(buf.slice(mdlsOffset, mdlsOffset + 200)).toString('hex'));

// 搜索整个文件里所有 "可能顶点数据"（80 字节 stride 的 float 簇）
// 简单策略：找 连续 200+ 个 float 值都在合理范围 (-5000..5000) 的区域
const floatChunks = [];
let run = 0, runStart = 0;
for (let i = 0; i + 4 <= buf.length; i += 4) {
  const f = dv.getFloat32(i, true);
  if (isFinite(f) && Math.abs(f) < 5000) {
    if (run === 0) runStart = i;
    run++;
  } else {
    if (run > 500) floatChunks.push([runStart, run]);
    run = 0;
  }
}
if (run > 500) floatChunks.push([runStart, run]);
console.log('\n大 float 簇（>500 个连续合理 float）:');
for (const [off, cnt] of floatChunks) {
  console.log('  @' + off + ' 长度 ' + cnt + ' floats (' + (cnt * 4) + 'B)');
}
