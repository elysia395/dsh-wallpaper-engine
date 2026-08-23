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
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// 找所有 4 字符 ASCII 标记（MDLV/MDLS/MDLX 等）
const marks = [];
for (let i = 0; i < buf.length - 8; i++) {
  if (buf[i] === 0x4d && buf[i + 1] === 0x44 && buf[i + 2] === 0x4c) {
    marks.push([i, buf.toString('ascii', i, i + 8)]);
    i += 7;
  }
}
console.log('MDL* 标记:', marks.map(([o, s]) => o + ':' + s.trim()).join('  '));

// 在 MDLS 之后搜索更多 mesh 区域：找"顶点簇"（顶点字节数 出现在 u32 位置）
const mdlsOffsets = marks.filter(([o, s]) => s.startsWith('MDLS')).map(([o]) => o);
console.log('\nMDLS at:', mdlsOffsets);

// 全面扫描整个文件（不限于 MDLS 前）：找 u32 值 %80==0 且后续有合理 float 序列的位置
const candidates = [];
for (let offset = 0; offset + 20000 < buf.length; offset += 4) {
  const vb = dv.getUint32(offset, true);
  if (vb > 0 && vb % 80 === 0 && vb <= 2000000) {
    // 检查 offset+8 处是否是合理 float 顶点
    const fx = dv.getFloat32(offset + 8, true);
    const fy = dv.getFloat32(offset + 12, true);
    if (isFinite(fx) && isFinite(fy) && Math.abs(fx) < 5000 && Math.abs(fy) < 5000) {
      const vo = offset + 8;
      const idxLenOff = vo + vb;
      if (idxLenOff + 4 <= buf.length) {
        const ib = dv.getUint32(idxLenOff, true);
        if (ib > 0 && ib % 2 === 0 && ib < 200000 && idxLenOff + 4 + ib <= buf.length) {
          const vc = vb / 80;
          // 校验索引
          let ok = true;
          for (let i = 0; i < Math.min(30, ib / 2); i++) {
            if (dv.getUint16(idxLenOff + 4 + i * 2, true) >= vc) { ok = false; break; }
          }
          if (ok) candidates.push({ offset, vb, ib, vc, idxCount: ib / 2 });
        }
      }
    }
  }
}
console.log('\n全部 mesh block 候选:');
for (const c of candidates) {
  console.log('  @' + c.offset, 'verts=' + c.vc, 'idx=' + c.idxCount, '区域=' + (c.offset < 64571 ? 'MDLS前' : 'MDLS后'));
}
