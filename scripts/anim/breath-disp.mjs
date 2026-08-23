// 解析 头_puppet.mdl 的"呼吸循环"动画 (additive, blend 0.74), 计算逐帧网格位移
import fs from 'fs';
const mod = await import('../lib/scene-renderer.js');
const pkg = mod.readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');
const buf = pkg.read('models/头_puppet.mdl');
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdla = buf.indexOf(Buffer.from('MDLA0006'));

// ── MDLS 骨骼 (B0/B1/B2 从 dump 已知; 重新稳健解析) ──
// B0: (-51.83, -250.55), B1: (20.9, 74.3), B2: (193.3, 322.4) — 硬编码已验证
const anchors = {
  0: { x: -51.83, y: -250.55 },
  1: { x: 20.9, y: 74.3 },
  2: { x: 193.3, y: 322.4 },
};

// ── 呼吸循环动画头 (loop-relative offsets) ──
const rxName = buf.indexOf(Buffer.from('呼吸循环', 'utf8'), mdla);
const rxLoop = buf.indexOf(Buffer.from('loop\0'), rxName);
const fps = dv.getFloat32(rxLoop + 5, true);
const frames = dv.getUint32(rxLoop + 9, true); // 120
const bones = dv.getUint32(rxLoop + 17, true); // 3
const blockSize = dv.getUint16(rxLoop + 25, true); // 4356
const dataStart = rxLoop + 29;
console.log(`呼吸循环: fps=${fps} frames=${frames} bones=${bones} blockSize=${blockSize} data@${dataStart} (rel mdla ${dataStart-mdla})`);

// 每骨骼块: frames+1 条 × 36B
const perBone = [];
for (let b = 0; b < bones; b++) {
  const rot = (2 * b) % 9;
  const framesArr = [];
  for (let f = 0; f <= frames; f++) {
    const o = dataStart + (b * (frames + 1) + f) * 36;
    const un = new Array(9);
    for (let i = 0; i < 9; i++) un[i] = dv.getFloat32(o + ((i + rot) % 9) * 4, true);
    framesArr.push({ pos: un.slice(0, 3), rot: un.slice(3, 6), scale: un.slice(6, 9) });
  }
  perBone.push(framesArr);
}
// 检查帧0 与锚点
for (let b = 0; b < bones; b++) {
  const f0 = perBone[b][0], f1 = perBone[b][1];
  console.log(`B${b}: f0 pos=(${f0.pos[0].toFixed(2)}, ${f0.pos[1].toFixed(2)}) rot=(${f0.rot.map(v=>v.toFixed(4)).join(',')}) scale=(${f0.scale.map(v=>v.toFixed(2)).join(',')})  anchor=(${anchors[b]?.x}, ${anchors[b]?.y})`);
}

// ── 网格顶点 ──
let verticesOffset = -1, vertexCount = 0;
for (let offset = 9; offset + 12 < mdla; offset++) {
  const vertexBytes = dv.getUint32(offset + 4, true);
  const vo = offset + 8;
  if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
  const ilo = vo + vertexBytes;
  if (ilo + 4 > mdla) continue;
  const indexBytes = dv.getUint32(ilo, true);
  const io = ilo + 4;
  if (indexBytes === 0 || indexBytes % 2 !== 0 || io + indexBytes > mdla) continue;
  verticesOffset = vo; vertexCount = vertexBytes / 80;
  break;
}
console.log(`顶点 ${vertexCount} @${verticesOffset}`);
const verts = [];
for (let i = 0; i < vertexCount; i++) {
  const o = verticesOffset + i * 80;
  verts.push({
    x: dv.getFloat32(o, true), y: dv.getFloat32(o + 4, true),
    bones: [dv.getUint32(o + 40, true), dv.getUint32(o + 44, true), dv.getUint32(o + 48, true), dv.getUint32(o + 52, true)],
    weights: [dv.getFloat32(o + 56, true), dv.getFloat32(o + 60, true), dv.getFloat32(o + 64, true), dv.getFloat32(o + 68, true)],
  });
}
// 顶点骨骼分布
const boneUse = {};
for (const v of verts) for (const b of v.bones) boneUse[b] = (boneUse[b] || 0) + 1;
console.log('顶点骨骼使用:', Object.entries(boneUse).map(([b, n]) => `B${b}:${n}`).join(' '));

// ── LBS 蒙皮位移 (每帧) ──
function skinFrame(f) {
  let tx = 0, ty = 0, wsum = 0;
  const dxs = [];
  for (const v of verts) {
    let fx = v.x, fy = v.y;
    for (let k = 0; k < 4; k++) {
      const w = v.weights[k];
      if (w <= 0.001) continue;
      const b = v.bones[k];
      if (b >= bones || !perBone[b] || !perBone[b][f]) continue;
      const fr = perBone[b][f];
      const an = anchors[b];
      if (!an) continue;
      const [rx, ry, rz] = fr.rot;
      const cz = Math.cos(rz), sz = Math.sin(rz);
      const cy = Math.cos(ry), sy = Math.sin(ry);
      const cx = Math.cos(rx), sx = Math.sin(rx);
      const lx = v.x - an.x, ly = v.y - an.y;
      // R = Rz*Ry*Rx
      const y1 = ly * cx, z1 = ly * sx;
      const x2 = lx * cy + z1 * sy, z2 = -lx * sy + z1 * cy;
      const wx = fr.pos[0] + x2 * cz - y1 * sz;
      const wy = fr.pos[1] + x2 * sz + y1 * cz;
      fx += w * (wx - v.x);
      fy += w * (wy - v.y);
    }
    dxs.push([fx - v.x, fy - v.y]);
    tx += fx - v.x; ty += fy - v.y;
    wsum += 1;
  }
  return { dx: tx / wsum, dy: ty / wsum, dxs };
}

console.log('\n=== 呼吸循环 逐帧网格整体位移 (含旋转) ===');
const disps = [];
for (let f = 0; f <= frames; f += 3) {
  const { dx, dy } = skinFrame(f);
  disps.push([f, dx, dy]);
  console.log(`f=${String(f).padStart(3)}: (${dx.toFixed(2)}, ${dy.toFixed(2)})`);
}
// 范围
let minDX = 1e9, maxDX = -1e9, minDY = 1e9, maxDY = -1e9;
for (const [, dx, dy] of disps) {
  if (dx < minDX) minDX = dx; if (dx > maxDX) maxDX = dx;
  if (dy < minDY) minDY = dy; if (dy > maxDY) maxDY = dy;
}
console.log(`dx 范围 [${minDX.toFixed(2)}, ${maxDX.toFixed(2)}], dy 范围 [${minDY.toFixed(2)}, ${maxDY.toFixed(2)}]`);
// f=0 (t=0 渲染用) 和 平均
const f0 = skinFrame(0);
console.log(`\nf=0 (t=0): (${f0.dx.toFixed(2)}, ${f0.dy.toFixed(2)})`);
// 平均位移 (全帧)
let ax = 0, ay = 0;
for (const [, dx, dy] of disps) { ax += dx; ay += dy; }
console.log(`平均位移: (${(ax/disps.length).toFixed(2)}, ${(ay/disps.length).toFixed(2)})`);
// 顶点级位移分布 (f=0)
const vd = f0.dxs.map(([x, y]) => Math.hypot(x, y));
vd.sort((a, b) => a - b);
console.log(`f=0 顶点位移: min=${vd[0].toFixed(2)} p50=${vd[Math.floor(vd.length/2)].toFixed(2)} max=${vd[vd.length-1].toFixed(2)}`);
