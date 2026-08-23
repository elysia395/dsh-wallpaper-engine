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

function scanMeshBlocks(buf) {
  const markerSize = 9;
  const vertexStride = 80;
  let mdlsOffset = buf.length;
  for (let off = markerSize; off + 4 < buf.length; off++) {
    if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const blocks = [];
  // 扫描从 markerSize 到 mdlsOffset 之间的所有候选
  for (let offset = markerSize; offset + 12 < mdlsOffset; offset++) {
    // header: 2×u32。探测哪种布局：可能是 [u32 vertexBytes, u32 indexBytes] 或 [u32 ?, u32 vertexBytes]
    for (const [hb, vb, ib] of [[0, 4, 8], [4, 0, 8]]) {
      const vertexBytes = dv.getUint32(offset + vb, true);
      const verticesOffset = offset + 8;
      if (vertexBytes <= 0 || vertexBytes % vertexStride !== 0 || vertexBytes > 2000000) continue;
      // 检查第一个顶点的位置值是否合理（float32）
      const fx = dv.getFloat32(verticesOffset, true);
      const fy = dv.getFloat32(verticesOffset + 4, true);
      const fz = dv.getFloat32(verticesOffset + 8, true);
      if (!isFinite(fx) || !isFinite(fy) || !isFinite(fz) || Math.abs(fx) > 50000 || Math.abs(fy) > 50000) continue;
      const indexLenOffset = verticesOffset + vertexBytes;
      if (indexLenOffset + 4 > mdlsOffset) continue;
      const indexBytes = dv.getUint32(indexLenOffset, true);
      const indicesOffset = indexLenOffset + 4;
      if (indexBytes <= 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
      // 检查索引有效性
      const vc = vertexBytes / vertexStride;
      let ok = true;
      for (let i = 0; i < Math.min(50, indexBytes / 2); i++) {
        const v = dv.getUint16(indicesOffset + i * 2, true);
        if (v >= vc) { ok = false; break; }
      }
      if (!ok) continue;
      blocks.push({ offset, layout: hb === 0 ? 'vb@0' : 'vb@4', vertexBytes, indexBytes, verticesOffset, indicesOffset, vertexCount: vc, indexCount: indexBytes / 2, first: [fx.toFixed(1), fy.toFixed(1), fz.toFixed(1)] });
      break;
    }
  }
  return { mdlsOffset, blocks };
}

const { read } = readPkg();
for (const mdlPath of ['models/人物_puppet.mdl', 'models/发_puppet.mdl']) {
  const buf = read(mdlPath);
  const { mdlsOffset, blocks } = scanMeshBlocks(buf);
  console.log('===', mdlPath, 'size', buf.length, 'MDLS@', mdlsOffset);
  for (const b of blocks) {
    console.log('  block@' + b.offset, b.layout, 'verts', b.vertexCount, 'idx', b.indexCount, 'firstPos(' + b.first.join(',') + ')');
  }
  console.log('  共', blocks.length, '个 mesh block');
}
