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

// 顶点 @36-80 详细字节分析（找骨骼索引和权重的精确布局）
console.log('顶点 @36-80 字节布局（前 20 顶点）:');
for (let v = 0; v < 20; v++) {
  const o = 79 + v * 80;
  // @36-39: float, @40-43: u32, @44-79: 9 floats
  const f36 = dv2.getFloat32(o + 36, true);
  const bi0 = dv2.getUint32(o + 40, true);
  const w0 = dv2.getFloat32(o + 44, true);
  const bi1 = dv2.getUint32(o + 48, true);
  const w1 = dv2.getFloat32(o + 52, true);
  const bi2 = dv2.getUint32(o + 56, true);
  const w2 = dv2.getFloat32(o + 60, true);
  const bi3 = dv2.getUint32(o + 64, true);
  const w3 = dv2.getFloat32(o + 68, true);
  const u = dv2.getFloat32(o + 72, true), vv = dv2.getFloat32(o + 76, true);
  console.log(
    'v' + String(v).padStart(2),
    'f36=' + f36.toFixed(2),
    'bi0=' + bi0, 'w0=' + w0.toFixed(2),
    'bi1=' + bi1, 'w1=' + w1.toFixed(2),
    'bi2=' + bi2, 'w2=' + w2.toFixed(2),
    'bi3=' + bi3, 'w3=' + w3.toFixed(2),
    'uv(' + u.toFixed(3) + ',' + vv.toFixed(3) + ')'
  );
}

// 统计所有顶点的权重组合
console.log('\n权重模式统计（所有 634 顶点）:');
const patterns = {};
for (let v = 0; v < 634; v++) {
  const o = 79 + v * 80;
  const bi0 = dv2.getUint32(o + 40, true);
  const w0 = dv2.getFloat32(o + 44, true);
  const bi1 = dv2.getUint32(o + 48, true);
  const w1 = dv2.getFloat32(o + 52, true);
  const bi2 = dv2.getUint32(o + 56, true);
  const w2 = dv2.getFloat32(o + 60, true);
  const bi3 = dv2.getUint32(o + 64, true);
  const w3 = dv2.getFloat32(o + 68, true);
  // 分类：单骨骼 or 多骨骼
  let kind;
  if (w1 === 0 && w2 === 0 && w3 === 0) kind = '单骨骼(bi=' + bi0 + ')';
  else if (w0 > 0 && w1 > 0 && w2 === 0) kind = '双骨骼(bi=' + bi0 + '+' + bi1 + ')';
  else if (w0 > 0 && w1 > 0 && w2 > 0 && w3 === 0) kind = '三骨骼(bi=' + bi0 + '+' + bi1 + '+' + bi2 + ')';
  else if (w0 > 0 && w1 > 0 && w2 > 0 && w3 > 0) kind = '四骨骼(bi=' + bi0 + '+' + bi1 + '+' + bi2 + '+' + bi3 + ')';
  else kind = '其他(bi=' + bi0 + ' w0=' + w0.toFixed(2) + ' w1=' + w1.toFixed(2) + ' w2=' + w2.toFixed(2) + ' w3=' + w3.toFixed(2) + ')';
  patterns[kind] = (patterns[kind] || 0) + 1;
}
for (const [k, c] of Object.entries(patterns).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + c + ' 顶点: ' + k);
}
