// 解析阿米娅 头_puppet.mdl: MDLS 骨骼 + MDLA 动画, 计算头部网格逐帧整体位移
import fs from 'fs';
const mod = await import('../lib/scene-renderer.js');
const pkg = mod.readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');
const buf = pkg.read('models/头_puppet.mdl');
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// 找 MDLS / MDLA / MDLE
const mdls = buf.indexOf(Buffer.from('MDLS'));
const mdla = buf.indexOf(Buffer.from('MDLA0006'));
let mdle = buf.length;
for (let i = mdla + 8; i + 8 < buf.length; i++) {
  if (buf.toString('ascii', i, i + 8) === 'MDLE0002') { mdle = i; break; }
}
console.log(`MDLS@${mdls} MDLA@${mdla} MDLE@${mdle} 总长${buf.length}`);

// ── 1. MDLS 骨骼 ──
const bones = [];
let p = mdls + 17;
for (let b = 0; b < 300 && p < mdla; b++) {
  const type = dv.getUint32(p + 1, true);
  const parent = dv.getUint32(p + 5, true);
  const entryLen = dv.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true }); continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  bones.push({ b, type, parent: parent === 0xffffffff ? -1 : parent, anchor: [floats[12] ?? NaN, floats[13] ?? NaN], info: infoStr.slice(0, 60) });
  p = infoStart + infoStr.length + 1;
}
console.log('骨骼数:', bones.length);
for (let i = 0; i < Math.min(bones.length, 35); i++) {
  const bn = bones[i];
  if (bn.error) { console.log(`  B${bn.b}: ERROR`); continue; }
  console.log(`  B${bn.b}: parent=${bn.parent} anchor=(${bn.anchor[0]?.toFixed(1) ?? '?'}, ${bn.anchor[1]?.toFixed(1) ?? '?'}) ${bn.info}`);
}

// ── 2. MDLA 动画头部: 按名字找 ──
function findAnim(name) {
  const nb = Buffer.from(name + '\0', 'utf8');
  const idx = buf.indexOf(nb, mdla);
  if (idx < 0) { console.log(`动画 "${name}" 未找到`); return null; }
  // name 之后: "loop\0" @+9, fps @+14, frames @+18, bones @+22, blockSize u16 @+34, data @+38
  const loopIdx = buf.indexOf(Buffer.from('loop\0'), idx);
  const fps = dv.getFloat32(idx + 14, true);
  const frames = dv.getUint32(idx + 18, true);
  const boneCnt = dv.getUint32(idx + 22, true);
  const blockSize = dv.getUint16(idx + 34, true);
  console.log(`动画 "${name}": name@${idx - mdla} loop@${loopIdx - mdla} fps=${fps} frames=${frames} bones=${boneCnt} blockSize=${blockSize}`);
  return { name, nameOff: idx - mdla, loopOff: loopIdx - mdla, fps, frames, boneCnt, blockSize };
}
const a1 = findAnim('动画 1');
const a2 = findAnim('呼吸循环');

// ── 3. 解析网格顶点 (stride 80) ──
// 用 _parseMdl 同样的逻辑找顶点区
let verticesOffset = -1, vertexCount = 0, indicesOffset = -1, indexCount = 0;
for (let offset = 9; offset + 12 < mdls; offset++) {
  const vertexBytes = dv.getUint32(offset + 4, true);
  const vo = offset + 8;
  if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
  const ilo = vo + vertexBytes;
  if (ilo + 4 > mdls) continue;
  const indexBytes = dv.getUint32(ilo, true);
  const io = ilo + 4;
  if (indexBytes === 0 || indexBytes % 2 !== 0 || io + indexBytes > mdls) continue;
  verticesOffset = vo; vertexCount = vertexBytes / 80; indicesOffset = io; indexCount = indexBytes / 2;
  break;
}
console.log(`顶点: ${vertexCount} @${verticesOffset}, 索引: ${indexCount} @${indicesOffset}`);
const verts = [];
for (let i = 0; i < vertexCount; i++) {
  const o = verticesOffset + i * 80;
  verts.push({
    x: dv.getFloat32(o, true), y: dv.getFloat32(o + 4, true),
    bones: [dv.getUint32(o + 40, true), dv.getUint32(o + 44, true), dv.getUint32(o + 48, true), dv.getUint32(o + 52, true)],
    weights: [dv.getFloat32(o + 56, true), dv.getFloat32(o + 60, true), dv.getFloat32(o + 64, true), dv.getFloat32(o + 68, true)],
  });
}

// ── 4. 逐帧计算网格整体位移 ──
function animDisplacement(anim) {
  if (!anim) return null;
  // 数据起点: 需验证. 试 nameOff + 38
  const base = mdla + anim.nameOff + 38;
  const nb = anim.boneCnt || bones.length;
  const perBone = [];
  for (let b = 0; b < nb; b++) {
    const rot = (2 * b) % 9;
    const frames = [];
    for (let f = 0; f <= anim.frames; f++) {
      const o = base + (b * (anim.frames + 1) + f) * 36;
      if (o + 36 > mdle) { frames.push(null); continue; }
      const un = new Array(9);
      for (let i = 0; i < 9; i++) un[i] = dv.getFloat32(o + ((i + rot) % 9) * 4, true);
      frames.push({ pos: un.slice(0, 3), rot: un.slice(3, 6), scale: un.slice(6, 9) });
    }
    perBone.push(frames);
  }
  // 每帧网格平移: 用权重平均 (简化: 只算 pos 平移, 含旋转时另算)
  const out = [];
  for (let f = 0; f <= anim.frames; f++) {
    let dx = 0, dy = 0, wsum = 0;
    for (const v of verts) {
      for (let k = 0; k < 4; k++) {
        const w = v.weights[k];
        if (w <= 0.001) continue;
        const b = v.bones[k];
        if (!perBone[b] || !perBone[b][f]) continue;
        const fr = perBone[b][f];
        const an = bones[b] && bones[b].anchor;
        if (!an || !isFinite(an[0])) continue;
        // 简化位移: animPos - anchor (平移部分)
        dx += w * (fr.pos[0] - an[0]);
        dy += w * (fr.pos[1] - an[1]);
        wsum += w;
      }
    }
    if (wsum > 0) out.push([f, dx / wsum, dy / wsum]);
  }
  return { perBone, frames: out };
}

for (const anim of [a1, a2]) {
  const res = animDisplacement(anim);
  if (!res) continue;
  console.log(`\n=== ${anim.name}: 网格整体位移 (dx, dy) ===`);
  // 打印前 20 帧 + 采样
  const fr = res.frames;
  for (let i = 0; i < Math.min(20, fr.length); i++) {
    console.log(`  f=${String(fr[i][0]).padStart(3)}: (${fr[i][1].toFixed(1)}, ${fr[i][2].toFixed(1)})`);
  }
  // 范围
  let minDX = 1e9, maxDX = -1e9, minDY = 1e9, maxDY = -1e9;
  for (const [, dx, dy] of fr) {
    if (dx < minDX) minDX = dx; if (dx > maxDX) maxDX = dx;
    if (dy < minDY) minDY = dy; if (dy > maxDY) maxDY = dy;
  }
  console.log(`  dx 范围 [${minDX.toFixed(1)}, ${maxDX.toFixed(1)}], dy 范围 [${minDY.toFixed(1)}, ${maxDY.toFixed(1)}]`);
  // 带旋转的完整蒙皮位移 (LBS), 采样几帧
  console.log('  完整 LBS 蒙皮 (含旋转) 采样:');
  for (const f of [0, 12, 30, 60]) {
    if (f >= fr.length) continue;
    let tx = 0, ty = 0, wsum = 0;
    for (const v of verts) {
      for (let k = 0; k < 4; k++) {
        const w = v.weights[k];
        if (w <= 0.001) continue;
        const b = v.bones[k];
        const frb = res.perBone[b] && res.perBone[b][f];
        if (!frb) continue;
        const an = bones[b] && bones[b].anchor;
        if (!an || !isFinite(an[0])) continue;
        const rot = frb.rot;
        const rx = rot[0], ry = rot[1], rz = rot[2];
        // 欧拉转矩阵 (按 ZYX? 简化: 只处理小角度, 用 z 旋转近似 + x/y 小)
        const cz = Math.cos(rz), sz = Math.sin(rz);
        const cy = Math.cos(ry), sy = Math.sin(ry);
        const cx = Math.cos(rx), sx = Math.sin(rx);
        const lx = v.x - an[0], ly = v.y - an[1];
        // R = Rz * Ry * Rx
        let px = lx, py = ly, pz = 0;
        // Rx
        let y1 = py * cx - pz * sx, z1 = py * sx + pz * cx;
        // Ry
        let x2 = px * cy + z1 * sy, z2 = -px * sy + z1 * cy;
        // Rz
        let x3 = x2 * cz - y1 * sz, y3 = x2 * sz + y1 * cz;
        const wx = frb.pos[0] + x3, wy = frb.pos[1] + y3;
        tx += w * (wx - v.x);
        ty += w * (wy - v.y);
        wsum += w;
      }
    }
    if (wsum > 0) console.log(`  f=${f}: 网格整体位移 (${(tx/wsum).toFixed(1)}, ${(ty/wsum).toFixed(1)})`);
  }
}
