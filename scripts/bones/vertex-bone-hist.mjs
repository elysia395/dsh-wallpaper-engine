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
for (const mdlName of ['models/人物_puppet.mdl', 'models/发_puppet.mdl']) {
  const buf = read(mdlName);
  const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let mdlsOffset = buf.length;
  for (let off = 9; off + 4 < buf.length; off++) {
    if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
  }
  let found = null;
  for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
    const vertexBytes = dv2.getUint32(offset + 4, true);
    const verticesOffset = offset + 8;
    if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
    const indexLenOffset = verticesOffset + vertexBytes;
    if (indexLenOffset + 4 > mdlsOffset) continue;
    const indexBytes = dv2.getUint32(indexLenOffset, true);
    const indicesOffset = indexLenOffset + 4;
    if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
    found = { verticesOffset, vertexBytes, indicesOffset, indexBytes };
    break;
  }
  if (!found) { console.log(mdlName, 'no mesh'); continue; }
  const vertexCount = found.vertexBytes / 80;
  const boneHist = {};
  for (let i = 0; i < vertexCount; i++) {
    const vo = found.verticesOffset + i * 80;
    const b0 = dv2.getUint32(vo + 40, true);
    const w0 = dv2.getFloat32(vo + 56, true);
    const w1 = dv2.getFloat32(vo + 60, true);
    boneHist[b0] = (boneHist[b0] || 0) + 1;
    // 检查是否多骨骼
    if (w1 > 0.01) console.log(`  ${mdlName} v${i}: b0=${b0} w0=${w0.toFixed(2)} w1=${w1.toFixed(2)}`);
  }
  console.log(`\n${mdlName}: ${vertexCount} 顶点, 骨骼分布:`);
  const sorted = Object.entries(boneHist).sort((a, b) => a[0] - b[0]);
  for (const [b, cnt] of sorted) console.log(`  B${b}: ${cnt} 顶点`);
}
