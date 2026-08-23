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
const mdls = 64571, mdla = 79842;

// 重新解析骨骼（保存矩阵平移列 m[12], m[13]）
let p = mdls + 17;
const boneMats = {};
for (let b = 0; b < 53 && p < mdla; b++) {
  const tmp = buf[p];
  const type = dv2.getUint32(p + 1, true);
  const unk1 = dv2.getUint32(p + 5, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  let tp = null;
  const m = infoStr.match(/"tp"\s*:\s*"([^"]+)"/);
  if (m) tp = m[1].trim().split(/\s+/).map(Number);
  boneMats[b] = { mat: floats, tp, type, unk1 };
  p = infoStart + infoStr.length + 1;
}

// 顶点: boneIdx @40(4×u32), weights @56(4×f32)
// 验证: 每个顶点的 rawPos 与它所属骨骼的矩阵平移列的关系
console.log('顶点 vs 骨骼矩阵平移验证（前 15 顶点）:');
for (let v = 0; v < 15; v++) {
  const o = 79 + v * 80;
  const x = dv2.getFloat32(o, true), y = dv2.getFloat32(o + 4, true);
  const b0 = dv2.getUint32(o + 40, true);
  const w0 = dv2.getFloat32(o + 56, true);
  const bm = boneMats[b0];
  if (!bm) { console.log('v' + v + ': 骨骼' + b0 + ' 无数据'); continue; }
  const boneX = bm.mat[12], boneY = bm.mat[13];
  const diff = Math.sqrt((x - boneX) ** 2 + (y - boneY) ** 2);
  console.log('v' + String(v).padStart(2) + ': pos(' + x.toFixed(1) + ',' + y.toFixed(1) + ') 骨骼' + b0 + ' bonePos(' + boneX.toFixed(1) + ',' + boneY.toFixed(1) + ') 距离=' + diff.toFixed(1) + (diff < 200 ? ' (近)' : ' (远)'));
}

// 统计: 顶点与所属骨骼的距离分布
console.log('\n顶点-骨骼距离分布:');
const dists = [];
for (let v = 0; v < 634; v++) {
  const o = 79 + v * 80;
  const x = dv2.getFloat32(o, true), y = dv2.getFloat32(o + 4, true);
  const b0 = dv2.getUint32(o + 40, true);
  const bm = boneMats[b0];
  if (!bm) continue;
  dists.push(Math.sqrt((x - bm.mat[12]) ** 2 + (y - bm.mat[13]) ** 2));
}
dists.sort((a, b) => a - b);
console.log('  中位数:', dists[Math.floor(dists.length / 2)].toFixed(1));
console.log('  <100:', dists.filter(d => d < 100).length, '<200:', dists.filter(d => d < 200).length, '<400:', dists.filter(d => d < 400).length, '全部:', dists.length);
