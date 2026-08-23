// 核心蒙皮测试: pos 局部坐标层级链 + rot 绕世界锚点旋转 + scale
// 对比 render-final-frames 的纯平移结果, 验证旋转/层级对运动幅度的影响
import fs from 'fs';
import path from 'path';

const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out';
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

function parseMeshAndBones(buf) {
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
  const vertexCount = found.vertexBytes / 80;
  const indexCount = found.indexBytes / 2;
  const positions = [], uvs = [], boneIdx = [], boneW = [];
  for (let i = 0; i < vertexCount; i++) {
    const vo = found.verticesOffset + i * 80;
    positions.push([dv2.getFloat32(vo, true), dv2.getFloat32(vo + 4, true), dv2.getFloat32(vo + 8, true)]);
    uvs.push([dv2.getFloat32(vo + 72, true), dv2.getFloat32(vo + 76, true)]);
    boneIdx.push([
      dv2.getUint32(vo + 40, true), dv2.getUint32(vo + 44, true),
      dv2.getUint32(vo + 48, true), dv2.getUint32(vo + 52, true),
    ]);
    boneW.push([
      dv2.getFloat32(vo + 56, true), dv2.getFloat32(vo + 60, true),
      dv2.getFloat32(vo + 64, true), dv2.getFloat32(vo + 68, true),
    ]);
  }
  const indices = [];
  for (let i = 0; i < indexCount; i++) indices.push(dv2.getUint16(found.indicesOffset + i * 2, true));

  // 骨骼: b, parent, anchor(局部偏移), tp
  let p = mdlsOffset + 17;
  const mdlaOffset = buf.indexOf(Buffer.from('MDLA0006'), mdlsOffset);
  const bones = [];
  for (let b = 0; b < 300 && p < mdlaOffset; b++) {
    const entryLen = dv2.getUint32(p + 9, true);
    if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true, parent: -1, anchor: [0, 0], tp: [0, 0] }); continue; }
    const floats = [];
    for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
    const infoStart = p + 13 + entryLen;
    let infoLen = 0;
    while (infoStart + infoLen < buf.length && buf[infoStart + infoLen] >= 32 && buf[infoStart + infoLen] < 127) infoLen++;
    const parent = dv2.getUint32(p + 5, true);
    bones.push({
      b,
      parent: parent === 0xffffffff ? -1 : parent,
      anchor: [floats[12] ?? 0, floats[13] ?? 0],
      tp: [floats[8] ?? 0, floats[9] ?? 0],
    });
    p = infoStart + infoLen + 1;
  }
  return { positions, uvs, indices, boneIdx, boneW, bones };
}

// 完整矩阵蒙皮: 局部变换(平移+旋转+缩放) 沿层级累积
// bindW[b] = 绑定世界矩阵; L[b] = T(pos)*R(rot)*S(scale) 局部; W[b] = W[parent]*L[b]
// v' = Σ w * W[b] * invBindW[b] * v
function matMul(a, b) { // 4x4 行主序
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[r*4+k] * b[k*4+c];
    o[r*4+c] = s;
  }
  return o;
}
function matInv(m) {
  const [m00,m01,m02,m03,m10,m11,m12,m13,m20,m21,m22,m23,m30,m31,m32,m33] = m;
  const A = [
    m11*m22*m33 + m12*m23*m31 + m13*m21*m32 - m13*m22*m31 - m12*m21*m33 - m11*m23*m32,
    m03*m22*m31 + m02*m21*m33 + m01*m23*m32 - m01*m22*m33 - m02*m23*m31 - m03*m21*m32,
    m03*m12*m31 + m01*m13*m32 + m02*m11*m33 - m02*m13*m31 - m01*m12*m33 - m03*m11*m32,
    m02*m13*m21 + m01*m12*m23 + m03*m11*m22 - m03*m12*m21 - m01*m13*m22 - m02*m11*m23,
    m03*m20*m32 + m02*m23*m30 + m01*m22*m33 - m01*m23*m32 - m02*m20*m33 - m03*m22*m30,
    m00*m23*m32 + m03*m22*m30 + m02*m20*m33 - m02*m23*m30 - m03*m20*m32 - m00*m22*m33,
    m00*m21*m32 + m01*m20*m33 + m03*m22*m30 - m03*m21*m30 - m00*m22*m31 - m01*m20*m32,
    m00*m12*m33 + m03*m11*m30 + m01*m13*m30 - m01*m12*m33 - m03*m10*m33 - m00*m13*m32,
    m03*m10*m32 + m02*m13*m30 + m01*m12*m33 - m01*m13*m32 - m02*m10*m33 - m03*m12*m30,
    m00*m13*m31 + m01*m10*m33 + m03*m11*m30 - m03*m10*m31 - m00*m11*m33 - m01*m13*m30,
    m00*m12*m31 + m01*m13*m30 + m02*m10*m33 - m02*m13*m30 - m00*m10*m33 - m01*m12*m30,
    m00*m11*m32 + m02*m10*m31 + m01*m12*m30 - m01*m10*m32 - m02*m11*m30 - m00*m12*m31,
    m02*m21*m30 + m03*m20*m31 + m01*m23*m30 - m01*m21*m30 - m03*m20*m31 - m02*m23*m30,
    m03*m20*m30 + m01*m20*m33 + m02*m23*m30 - m02*m20*m33 - m03*m20*m30 - m01*m20*m33,
    m01*m20*m32 + m02*m20*m31 + m03*m21*m30 - m03*m20*m31 - m02*m20*m31 - m01*m21*m30,
    m01*m20*m31 + m02*m21*m30 + m03*m20*m30 - m03*m20*m31 - m02*m20*m30 - m01*m21*m30,
  ];
  // 简化: 2D 场景只有 z 旋转, 用逆变换直接算
  return null;
}
function mat2dMul(a, b) {
  // 2x3 affine: [a0 a1 a2; a3 a4 a5] 行主序
  return [
    a[0]*b[0] + a[1]*b[3], a[0]*b[1] + a[1]*b[4], a[0]*b[2] + a[1]*b[5] + a[2],
    a[3]*b[0] + a[4]*b[3], a[3]*b[1] + a[4]*b[4], a[3]*b[2] + a[4]*b[5] + a[5],
  ];
}
function mat2dInv(m) {
  const det = m[0]*m[4] - m[1]*m[3];
  if (Math.abs(det) < 1e-12) return [1,0,0,0,1,0];
  const id = 1/det;
  return [m[4]*id, -m[1]*id, (m[1]*m[5]-m[2]*m[4])*id, -m[3]*id, m[0]*id, (m[2]*m[3]-m[0]*m[5])*id];
}
function mat2dApply(m, x, y) { return [m[0]*x + m[1]*y + m[2], m[3]*x + m[4]*y + m[5]]; }
function buildSkinFull(positions, boneIdx, boneW, bones, framePose) {
  const N = bones.length;
  // 绑定世界矩阵: bindW[b] = bindW[parent] * T(anchor)
  const bindW = new Array(N).fill(null);
  for (let b = 0; b < N; b++) {
    const tx = bones[b].anchor[0], ty = bones[b].anchor[1];
    const T = [1, 0, tx, 0, 1, ty];
    bindW[b] = bones[b].parent < 0 ? T : mat2dMul(bindW[bones[b].parent], T);
  }
  const invBind = new Array(N).fill(null);
  for (let b = 0; b < N; b++) invBind[b] = mat2dInv(bindW[b]);
  // 动画世界矩阵: W[b] = W[parent] * (T(pos)*R(rot)*S(scale))
  const W = new Array(N).fill(null);
  for (let b = 0; b < N; b++) {
    const fr = framePose[b];
    const px = (fr && isFinite(fr.pos[0]) && Math.abs(fr.pos[0]) < 5000) ? fr.pos[0] : bones[b].anchor[0];
    const py = (fr && isFinite(fr.pos[1]) && Math.abs(fr.pos[1]) < 5000) ? fr.pos[1] : bones[b].anchor[1];
    const rz = (fr && isFinite(fr.rot[2])) ? fr.rot[2] : 0;
    let sc = 1;
    if (fr && fr.scale && isFinite(fr.scale[0]) && fr.scale[0] > 0.01) sc = fr.scale[0];
    const cos = Math.cos(rz), sin = Math.sin(rz);
    const L = [cos*sc, -sin*sc, px, sin*sc, cos*sc, py];
    W[b] = bones[b].parent < 0 ? L : mat2dMul(W[bones[b].parent], L);
  }
  const out = [];
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i];
    let sx = 0, sy = 0;
    for (let k = 0; k < 4; k++) {
      const bi = boneIdx[i][k];
      const w = boneW[i][k];
      if (bi >= N || w === 0) continue;
      // local = invBind * v
      const loc = mat2dApply(invBind[bi], v[0], v[1]);
      const world = mat2dApply(W[bi], loc[0], loc[1]);
      sx += w * world[0];
      sy += w * world[1];
    }
    out.push([sx, sy, v[2]]);
  }
  return out;
}

// 纯平移 (旧方法, 用于对比)
function buildSkinOld(positions, boneIdx, boneW, bones, framePose) {
  const out = [];
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i];
    let dx = 0, dy = 0;
    for (let k = 0; k < 4; k++) {
      const bi = boneIdx[i][k];
      const w = boneW[i][k];
      if (bi >= bones.length || w === 0) continue;
      const fr = framePose[bi];
      const na = (fr && isFinite(fr.pos[0]) && Math.abs(fr.pos[0]) < 5000) ? [fr.pos[0], fr.pos[1]] : bones[bi].anchor;
      dx += w * (na[0] - bones[bi].anchor[0]);
      dy += w * (na[1] - bones[bi].anchor[1]);
    }
    out.push([v[0] + dx, v[1] + dy, v[2]]);
  }
  return out;
}

const { read } = readPkg();
const model = JSON.parse(Buffer.from(read('models/人物.json')).toString('utf8'));
const mdlRaw = read(model.puppet);
const mesh = parseMeshAndBones(mdlRaw);
console.log('骨骼数:', mesh.bones.filter(b=>!b.error).length, '顶点:', mesh.positions.length);

const animData = JSON.parse(fs.readFileSync(path.join(OUT, 'mdla-anim-data.json'), 'utf8'));
// 用 mdla-anim-data.json 的 bones (已正确解析 53 骨骼 anchor/parent)
mesh.bones = animData.bones.map((b, idx) => ({ b: idx, parent: b.parent, anchor: [b.anchor[0], b.anchor[1]], tp: [b.tp[0], b.tp[1]] }));
console.log('使用 mdla-anim-data bones:', mesh.bones.length);
// animData.bones 的 anchor 与 MDL 解析的一致吗?
console.log('mdla-anim-data bones[0]:', JSON.stringify(animData.bones[0]));
console.log('MDL bones[0]:', JSON.stringify(mesh.bones[0]));

function pose2(f) {
  const pose = new Array(53);
  for (let i = 0; i < 53; i++) pose[i] = animData.anim2.perBone[i].frames[f];
  return pose;
}

// 对比 f12 vs f66: 位移最大顶点
const p12 = pose2(12), p66 = pose2(66);
const s12 = buildSkinFull(mesh.positions, mesh.boneIdx, mesh.boneW, mesh.bones, p12);
const s66 = buildSkinFull(mesh.positions, mesh.boneIdx, mesh.boneW, mesh.bones, p66);
let maxD = 0, maxI = 0, sumD = 0;
for (let i = 0; i < s12.length; i++) {
  const d = Math.hypot(s66[i][0] - s12[i][0], s66[i][1] - s12[i][1]);
  sumD += d;
  if (d > maxD) { maxD = d; maxI = i; }
}
console.log('完整矩阵蒙皮 f12→f66: 最大顶点位移', maxD.toFixed(1), 'px @v'+maxI, '平均', (sumD/s12.length).toFixed(1));

const o12 = buildSkinOld(mesh.positions, mesh.boneIdx, mesh.boneW, mesh.bones, p12);
const o66 = buildSkinOld(mesh.positions, mesh.boneIdx, mesh.boneW, mesh.bones, p66);
let omaxD = 0, osumD = 0;
for (let i = 0; i < o12.length; i++) {
  const d = Math.hypot(o66[i][0] - o12[i][0], o66[i][1] - o12[i][1]);
  osumD += d;
  if (d > omaxD) omaxD = d;
}
console.log('旧纯平移 f12→f66: 最大顶点位移', omaxD.toFixed(1), 'px 平均', (osumD/s12.length).toFixed(1));

// 验证: 完整蒙皮 f12 静止帧应≈原始顶点位置 (矩阵蒙皮正确性)
let vmax=0, vsum=0;
for (let i = 0; i < s12.length; i++) {
  const d = Math.hypot(s12[i][0]-mesh.positions[i][0], s12[i][1]-mesh.positions[i][1]);
  vsum += d; if (d>vmax) vmax = d;
}
console.log('完整蒙皮 f12 静止帧 vs 原始顶点: 最大偏移', vmax.toFixed(2), '平均', (vsum/s12.length).toFixed(2));
// anim1 增量测试: 呼吸基底 + B4 增量
function poseMix(f2, f1, blend=1) {
  const pose = new Array(53);
  for (let i = 0; i < 53; i++) {
    const p2 = animData.anim2.perBone[i].frames[f2];
    const p1 = animData.anim1.perBone[i].frames[f1];
    const base1 = animData.anim1.perBone[i].frames[12];
    const anc = animData.bones[i].anchor;
    if (!p2 || !p1 || !base1) { pose[i] = p2; continue; }
    const dx = (isFinite(p1.pos[0]) && Math.abs(p1.pos[0])<5000 && isFinite(base1.pos[0]) && Math.abs(base1.pos[0])<5000) ? (p1.pos[0]-base1.pos[0])*blend : 0;
    const dy = (isFinite(p1.pos[1]) && Math.abs(p1.pos[1])<5000 && isFinite(base1.pos[1]) && Math.abs(base1.pos[1])<5000) ? (p1.pos[1]-base1.pos[1])*blend : 0;
    pose[i] = {
      pos: [p2.pos[0]+dx, p2.pos[1]+dy, 0],
      rot: p2.rot, scale: p2.scale,
    };
  }
  return pose;
}
// anim1 f12 静止: mix(f2,12) == anim2 f2
const m12 = buildSkinFull(mesh.positions, mesh.boneIdx, mesh.boneW, mesh.bones, poseMix(66, 12));
let md = 0;
for (let i = 0; i < m12.length; i++) md = Math.max(md, Math.hypot(m12[i][0]-s66[i][0], m12[i][1]-s66[i][1]));
console.log('混合(f66,f12静止) vs 纯anim2 f66: 最大差', md.toFixed(2), 'px (应≈0)');
// anim1 f67 眨眼: mix(f66,67) vs anim2 f66
const m67 = buildSkinFull(mesh.positions, mesh.boneIdx, mesh.boneW, mesh.bones, poseMix(66, 67));
let m67d = 0;
for (let i = 0; i < m67.length; i++) m67d = Math.max(m67d, Math.hypot(m67[i][0]-s66[i][0], m67[i][1]-s66[i][1]));
console.log('混合(f66,f67眨眼) vs 纯anim2 f66: 最大差', m67d.toFixed(1), 'px (头部增量)');
