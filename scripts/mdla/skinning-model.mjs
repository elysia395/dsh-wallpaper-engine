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

// 解析骨骼矩阵
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
  boneMats[b] = { mat: floats, info: infoStr.slice(0, 40) };
  p = infoStart + infoStr.length + 1;
}

// 蒙皮验证: finalPos = Σ w_i × (boneMat_i × (rawPos - bonePos_i))，参考姿态矩阵=单位+平移
// 但矩阵含旋转部分(单位)，所以 boneMat × local = local + bonePos = rawPos
// 验证: Σ w_i × (local_i + bonePos_i) ≈ rawPos?
// local_i = rawPos - bonePos_i? 不对——每个骨骼的 local 不同
// 正确模型: 顶点在模型空间，骨骼动画 = Σ w_i × boneAnimMat_i × invBoneBindMat_i × rawPos
// 参考姿态: boneAnimMat = boneBindMat → finalPos = rawPos ✓
// 所以需要: 骨骼绑定矩阵(bind) + 动画矩阵(anim)
// bind 矩阵 = 我们解析的 mat（单位旋转+平移=骨骼位置）
// 验证: Σ w_i × (bonePos_i + (rawPos - bonePos_i)) 用每骨骼不同 local
// local_i 未知，但参考姿态下 finalPos 必须 = rawPos
// 检查: 对每个顶点，Σ w_i × bonePos_i 是否 = rawPos（若 local_i 相同）
console.log('蒙皮验证: Σ w_i × bonePos_i vs rawPos（前 10 顶点）:');
for (let v = 0; v < 10; v++) {
  const o = 79 + v * 80;
  const x = dv2.getFloat32(o, true), y = dv2.getFloat32(o + 4, true);
  const bones = [dv2.getUint32(o + 40, true), dv2.getUint32(o + 44, true), dv2.getUint32(o + 48, true), dv2.getUint32(o + 52, true)];
  const ws = [dv2.getFloat32(o + 56, true), dv2.getFloat32(o + 60, true), dv2.getFloat32(o + 64, true), dv2.getFloat32(o + 68, true)];
  let sx = 0, sy = 0;
  for (let k = 0; k < 4; k++) {
    const bm = boneMats[bones[k]];
    if (bm && ws[k] > 0.001) {
      sx += ws[k] * bm.mat[12];
      sy += ws[k] * bm.mat[13];
    }
  }
  console.log('v' + v + ': rawPos(' + x.toFixed(0) + ',' + y.toFixed(0) + ') Σw·bonePos(' + sx.toFixed(0) + ',' + sy.toFixed(0) + ') 差(' + (x - sx).toFixed(0) + ',' + (y - sy).toFixed(0) + ')');
}
