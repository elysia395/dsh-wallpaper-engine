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

// 骨骼数据
let p = mdls + 17;
const bones = [];
for (let b = 0; b < 53 && p < mdla; b++) {
  const tmp = buf[p];
  const type = dv2.getUint32(p + 1, true);
  const parent = dv2.getUint32(p + 5, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, parent: -2 }); continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  let tp = null;
  const m = infoStr.match(/"tp"\s*:\s*"([^"]+)"/);
  if (m) tp = m[1].trim().split(/\s+/).map(Number);
  bones.push({ b, parent, mat: floats, tp, info: infoStr.slice(0, 40) });
  p = infoStart + infoStr.length + 1;
}

// 关键验证: 顶点 rawPos 是"骨骼局部空间"还是"世界空间"?
// 方法: 对每个顶点, 计算 Σ w_i × (boneWorld_i)，看是否 ≈ rawPos 的某种变换
// boneWorld 用 tp 累加
function boneWorld(b) {
  const bone = bones.find(x => x.b === b);
  if (!bone || bone.parent === -2) return [0, 0];
  if (bone.parent === 4294967295) return [0, 0];
  const pw = boneWorld(bone.parent);
  const tp = bone.tp || [0, 0];
  return [pw[0] + tp[0], pw[1] + tp[1]];
}
// 计算各骨骼世界位置
const boneWorldMap = {};
for (const b of bones) {
  if (b.parent === -2) continue;
  boneWorldMap[b.b] = boneWorld(b.b);
}

// 顶点绑定检查: 顶点 rawPos vs 骨骼世界位置
console.log('骨骼世界位置 vs 顶点(rawPos) 对比:');
console.log('骨骼 B3 world:', boneWorldMap[3].map(v => v.toFixed(0)));
console.log('骨骼 B38 world:', boneWorldMap[38].map(v => v.toFixed(0)));
console.log('骨骼 B40 world:', boneWorldMap[40].map(v => v.toFixed(0)));

// 顶点: 同骨骼的顶点是否围绕骨骼世界位置?
// B37 世界位置?
console.log('B37 world:', boneWorldMap[37]?.map(v => v.toFixed(0)));
// v3 (骨骼37): rawPos(163.7, 1002.7)
// 若 rawPos = boneWorld + local → local = rawPos - boneWorld
console.log('\n顶点-骨骼世界偏移:');
for (let v = 0; v < 8; v++) {
  const o = 79 + v * 80;
  const x = dv2.getFloat32(o, true), y = dv2.getFloat32(o + 4, true);
  const b = dv2.getUint32(o + 40, true);
  const bw = boneWorldMap[b] || [0, 0];
  console.log('v' + v + ': rawPos(' + x.toFixed(0) + ',' + y.toFixed(0) + ') 骨骼' + b + ' world(' + bw[0].toFixed(0) + ',' + bw[1].toFixed(0) + ') 差(' + (x - bw[0]).toFixed(0) + ',' + (y - bw[1]).toFixed(0) + ')');
}
