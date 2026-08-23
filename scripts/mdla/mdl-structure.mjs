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
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// 检查 mesh block @71 附近结构
console.log('=== 头部到 mesh block ===');
console.log('MDLV0023 @0, 后面是?');
// 0x09 后: u32 等
console.log('字节 0-64 hex:', Buffer.from(buf.slice(0, 64)).toString('hex'));
console.log('u32 @9:', dv.getUint32(9, true), '@13:', dv.getUint32(13, true), '@17:', dv.getUint32(17, true), '@21:', dv.getUint32(21, true));

// mesh @71: 前 32 字节
console.log('\nmesh header @71-103:', Buffer.from(buf.slice(71, 103)).toString('hex'));
console.log('u32 @71:', dv.getUint32(71, true), '@75:', dv.getUint32(75, true), '@79:', dv.getUint32(79, true));
console.log('顶点流 @79 开始, 前3顶点 x,y,z:');
for (let v = 0; v < 3; v++) {
  const o = 79 + v * 80;
  console.log('  v' + v, 'pos(' + dv.getFloat32(o, true).toFixed(1) + ',' + dv.getFloat32(o + 4, true).toFixed(1) + ',' + dv.getFloat32(o + 8, true).toFixed(1) + ')',
    'uv@72(' + dv.getFloat32(o + 72, true).toFixed(3) + ',' + dv.getFloat32(o + 76, true).toFixed(3) + ')');
}

// 顶点流结束后
const vb = dv.getUint32(75, true);
console.log('\n顶点字节数 @75:', vb, '=' + (vb / 80) + ' 顶点');
const idxLenOff = 79 + vb;
console.log('索引字节数 @' + idxLenOff + ':', dv.getUint32(idxLenOff, true));
const idxOff = idxLenOff + 4;
console.log('索引 @' + idxOff + ' 前6:', dv.getUint16(idxOff, true), dv.getUint16(idxOff + 2, true), dv.getUint16(idxOff + 4, true), dv.getUint16(idxOff + 6, true), dv.getUint16(idxOff + 8, true), dv.getUint16(idxOff + 10, true));

// mesh block 之后到 MDLS@64571 之间有什么
const afterIdx = idxOff + dv.getUint32(idxLenOff, true);
console.log('\n索引结束 @' + afterIdx + ', 到 MDLS@64571 间隔', 64571 - afterIdx);
console.log('间隔内容 hex:', Buffer.from(buf.slice(afterIdx, Math.min(afterIdx + 100, 64571))).toString('hex').slice(0, 200));

// 顶点 y 范围（贴图对应）
console.log('\n顶点 y 范围（贴图空间 size/2 - rawY）:');
let minY = 1e9, maxY = -1e9, minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
const sizeY = 3776;
for (let v = 0; v < vb / 80; v++) {
  const o = 79 + v * 80;
  const ry = dv.getFloat32(o + 4, true);
  const ty = sizeY / 2 - ry;
  minY = Math.min(minY, ty); maxY = Math.max(maxY, ty);
  const u = dv.getFloat32(o + 72, true), vv = dv.getFloat32(o + 76, true);
  minU = Math.min(minU, u); maxU = Math.max(maxU, u);
  minV = Math.min(minV, vv); maxV = Math.max(maxV, vv);
}
console.log('  贴图空间 y:', minY.toFixed(0), '-', maxY.toFixed(0), '(', (minY / 3776 * 100).toFixed(0) + '%-' + (maxY / 3776 * 100).toFixed(0) + '%)');
console.log('  UV u:', minU.toFixed(3), '-', maxU.toFixed(3), ' v:', minV.toFixed(3), '-', maxV.toFixed(3));
console.log('  UV→贴图 y:', (minV * 3776).toFixed(0), '-', (maxV * 3776).toFixed(0));
