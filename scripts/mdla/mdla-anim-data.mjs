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

// MDLA 结构: 头部 + 动画数据
// 头部: MDLA0006(8) + u32 + u32(512?) + "动画 1"(utf8) + "loop" + 数据
// 数据区: 每 36B 一个骨骼条目? 之前发现 "r-" 每 36B
// 重新精确定位: @74 起 36B 步长，检查前 53 个条目
console.log('MDLA 动画数据（@74 起, 36B 步长, 前 53 骨骼）:');
const boneData = [];
for (let b = 0; b < 53; b++) {
  const o = mdla + 74 + b * 36;
  // 检查是否越界到 MDLE
  if (o + 36 > mdle) { console.log('B' + b + ' 越界'); break; }
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  boneData.push(vals);
  if (b < 8 || b >= 45) {
    console.log('B' + String(b).padStart(2) + ': [' + vals.map(f => f.toFixed(2)).join(', ') + ']');
  }
}
console.log('\n...');
console.log('B45-B52:');
for (let b = 45; b < 53; b++) {
  const vals = boneData[b];
  console.log('B' + String(b).padStart(2) + ': [' + vals.map(f => f.toFixed(2)).join(', ') + ']');
}

// 检查这些值是否合理（应该是动画首帧的骨骼变换：旋转 + 平移）
// 36B = 9 float = 3x3 旋转? 但看 B0 是 [0,0,0,0,0,0,1,0,0] 不像旋转
// 也许 36B 步长不对，或数据区起点不对
// 找 "1.0 0.0 0.0 0.0 0.0 1.0" 单位矩阵模式（绑定矩阵应该在动画数据里）
console.log('\n扫描单位矩阵（16 float 4x4）在 MDLA 数据区:');
const idents = [];
for (let off = mdla + 70; off + 64 * 3 < mdle; off += 4) {
  const m = [dv2.getFloat32(off, true), dv2.getFloat32(off + 4, true), dv2.getFloat32(off + 8, true), dv2.getFloat32(off + 12, true),
             dv2.getFloat32(off + 16, true), dv2.getFloat32(off + 20, true), dv2.getFloat32(off + 24, true), dv2.getFloat32(off + 28, true),
             dv2.getFloat32(off + 32, true), dv2.getFloat32(off + 36, true), dv2.getFloat32(off + 40, true), dv2.getFloat32(off + 44, true)];
  if (Math.abs(m[0]-1)<0.001 && Math.abs(m[5]-1)<0.001 && Math.abs(m[10]-1)<0.001 &&
      Math.abs(m[1])<0.001 && Math.abs(m[2])<0.001 && Math.abs(m[4])<0.001 && Math.abs(m[6])<0.001 && Math.abs(m[8])<0.001 && Math.abs(m[9])<0.001) {
    idents.push(off - mdla);
    if (idents.length > 8) break;
  }
}
console.log('单位矩阵位置:', idents.join(', '));
