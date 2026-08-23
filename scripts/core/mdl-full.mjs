// MDL puppet 完整解析: MDLV 顶点 + MDLS 骨骼 + MDLA 动画
// 结构 (逆向确认):
//   MDLV0023\0 + 头部 + 顶点流 (80B stride: pos@0, blendindices@40 u32×4, blendweight@56, uv@72)
//   + u32 索引字节 + u16 索引流
//   MDLS0004\0 + u32 段字节 + u32 骨骼数 + BONEENTRY×N
//     BONEENTRY = u8 tmp + u32 type + u32 parent + u32 entryLen + 4x4 矩阵(64B) + JSON 属性\0
//   MDLA0006\0 + u32 总字节 + u32 动画数 + 动画条目×M
//     动画条目 = u32 时长? + u32 0 + name\0 + mode\0 + [00 00] + [f0 41]
//               + u16 帧数 + u16 0 + u32 0 + u32 骨骼数 + u32 0 + u32 段字节
//               + 骨骼段×骨骼数 (每段 段字节 = (帧数+1)×36B)
//     每块 36B = 9 floats = [b0.xy, b1.xy, b2.xy, ?, ?, ?] (每骨骼段只更新自己的 pos.xy @ 2×boneIdx)
import { readPkg } from '../../lib/we-renderer/textures.js';

export function parseMdlFull(mdl) {
  const dv = new DataView(mdl.buffer, mdl.byteOffset, mdl.byteLength);
  const u32 = (o) => dv.getUint32(o, true);
  const f32 = (o) => dv.getFloat32(o, true);
  const i32 = (o) => dv.getInt32(o, true);

  // ── MDLV 顶点 ──
  const mdlsOff = (() => {
    for (let o = 9; o + 4 < mdl.length; o++) {
      if (mdl[o] === 0x4d && mdl[o + 1] === 0x44 && mdl[o + 2] === 0x4c && mdl[o + 3] === 0x53) return o;
    }
    return mdl.length;
  })();
  let mesh = null;
  for (let offset = 9; offset + 12 < mdlsOff; offset++) {
    const vertexBytes = u32(offset + 4);
    const vo = offset + 8;
    if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
    const io = vo + vertexBytes;
    if (io + 4 > mdlsOff) continue;
    const indexBytes = u32(io);
    if (indexBytes === 0 || indexBytes % 2 !== 0 || io + 4 + indexBytes > mdlsOff) continue;
    mesh = { vo, vertexBytes, io: io + 4, indexBytes };
    break;
  }
  if (!mesh) return null;
  const vc = mesh.vertexBytes / 80;
  const positions = [], blendIndices = [], blendWeights = [], uvs = [];
  for (let i = 0; i < vc; i++) {
    const o = mesh.vo + i * 80;
    positions.push([f32(o), f32(o + 4), f32(o + 8)]);
    blendIndices.push([u32(o + 40), u32(o + 44), u32(o + 48), u32(o + 52)]);
    blendWeights.push([f32(o + 56), f32(o + 60), f32(o + 64), f32(o + 68)]);
    uvs.push([f32(o + 72), f32(o + 76)]);
  }
  const indices = [];
  for (let i = 0; i < mesh.indexBytes / 2; i++) indices.push(dv.getUint16(mesh.io + i * 2, true));

  // ── MDLS 骨骼 ──
  let bones = [];
  let mdlaOff = mdl.length;
  if (mdlsOff < mdl.length) {
    let p = mdlsOff + 9;
    p += 4; // 段字节
    const boneCount = u32(p); p += 4;
    for (let b = 0; b < boneCount && p + 12 < mdl.length; b++) {
      const tmp = mdl[p];
      const type = u32(p + 1);
      const parent = i32(p + 5);
      p += 9;
      const len = u32(p); p += 4;
      const m = [];
      for (let i = 0; i < 16; i++) m.push(f32(p + i * 4));
      p += len;
      // JSON 属性 (NUL 终止)
      let je = p;
      while (je < mdl.length && mdl[je] !== 0) je++;
      const info = mdl.toString('utf8', p, je);
      p = je + 1;
      bones.push({ index: b, tmp, type, parent: parent === -1 ? -1 : parent, bind: m, info });
    }
    mdlaOff = mdl.indexOf('MDLA');
  }

  // ── MDLA 动画 ──
  const animations = [];
  if (mdlaOff >= 0 && mdlaOff < mdl.length) {
    let p = mdlaOff + 9;
    p += 4; // 总字节
    const animCount = u32(p); p += 4;
    for (let a = 0; a < animCount && p + 12 < mdl.length; a++) {
      p += 8; // u32 时长 + u32 0
      const nameEnd = mdl.indexOf(0, p);
      if (nameEnd < 0) break;
      const name = mdl.toString('utf8', p, nameEnd);
      p = nameEnd + 1;
      const loopEnd = mdl.indexOf(0, p);
      if (loopEnd < 0) break;
      const mode = mdl.toString('utf8', p, loopEnd);
      p = loopEnd + 1;
      // 找 [f0 41] 前缀
      while (p + 1 < mdl.length && !(mdl[p] === 0xf0 && mdl[p + 1] === 0x41)) p++;
      p += 2;
      const frameCount = dv.getUint16(p, true); p += 2;
      p += 2; // u16 0
      p += 4; // u32 0
      const boneCount = u32(p); p += 4;
      p += 4; // u32 0
      const segBytes = u32(p); p += 4;
      const dataStart = p;
      // 骨骼段 (每段 = 段字节, 每块 36B)
      const segs = [];
      for (let b = 0; b < boneCount && dataStart + (b + 1) * segBytes <= mdl.length; b++) {
        segs.push(dataStart + b * segBytes);
      }
      animations.push({ name, mode, frameCount, boneCount, segBytes, segs });
      p = dataStart + segBytes * boneCount;
    }
  }

  return { positions, blendIndices, blendWeights, uvs, indices, bones, animations, vc, ic: indices.length };
}

// 骨骼局部矩阵 (2D): T(pos.xy) × Rz(rot.z) × S(scale), 列主序 4x4
export function boneLocalMatrix(pos, rotZ = 0, scale = 1) {
  const c = Math.cos(rotZ), s = Math.sin(rotZ);
  return [
    c * scale, s * scale, 0, 0,
    -s * scale, c * scale, 0, 0,
    0, 0, 1, 0,
    pos[0], pos[1], 0, 1,
  ];
}

export function matMul(a, b) {
  // 列主序 4x4: a × b
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

// 4x4 求逆 (仿射)
export function matInvert(m) {
  // 旋转部分 (3x3 左上) 转置, 平移取负
  const r = new Array(16);
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) r[c * 4 + rr] = m[rr * 4 + c];
  r[3] = 0; r[7] = 0; r[11] = 0; r[15] = 1;
  r[12] = -(m[12] * r[0] + m[13] * r[4] + m[14] * r[8]);
  r[13] = -(m[12] * r[1] + m[13] * r[5] + m[14] * r[9]);
  r[14] = -(m[12] * r[2] + m[13] * r[6] + m[14] * r[10]);
  return r;
}

// 测试
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const pkg = readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');
  for (const m of ['models/头_puppet.mdl', 'models/左大衣_puppet.mdl', 'models/眉毛_puppet.mdl']) {
    const mdl = pkg.read(m);
    const r = parseMdlFull(mdl);
    console.log('===', m);
    if (!r) { console.log('  FAIL'); continue; }
    console.log('  顶点', r.vc, '索引', r.ic, '骨骼', r.bones.length, '动画', r.animations.length);
    for (const a of r.animations) {
      console.log('  anim "' + a.name + '" 帧' + a.frameCount + ' 骨' + a.boneCount + ' 段' + a.segBytes);
      // 每骨骼段首块 pos.xy
      for (let b = 0; b < Math.min(a.boneCount, 3); b++) {
        const x = mdl.readFloatLE(a.segs[b] + b * 2 * 4);
        const y = mdl.readFloatLE(a.segs[b] + b * 2 * 4 + 4);
        console.log('    骨' + b + ' 首帧 pos.xy =', x.toFixed(2), y.toFixed(2));
      }
    }
  }
}
