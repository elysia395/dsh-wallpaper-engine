// MDLA 布局实验: 验证 "每骨骼段连续 + 帧内 (2b)%9 偏移" 假设
// 对比当前实现 (帧内骨骼连续) vs 假设布局的蒙皮 bbox
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3554161528/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 66);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mesh = r._parseMdl(buf);

const bbox = (pts) => { let a=1e9,b=1e9,c=-1e9,d=-1e9; for (const p of pts){a=Math.min(a,p[0]);b=Math.min(b,p[1]);c=Math.max(c,p[0]);d=Math.max(d,p[1]);} return {minX:a,minY:b,maxX:c,maxY:d}; };
const bind = bbox(mesh.positions);
console.log('绑定姿态: ' + JSON.stringify(bind));

// 当前实现蒙皮
const cur = bbox(r._skinPuppet(mesh, 2.5, 0, 0));
console.log('当前蒙皮: ' + JSON.stringify(cur));

// 布局 A: 每骨骼段 = segs[b], 帧 k 内偏移 (2b)%9 读 2 floats
const anim = mesh.animations[0];
const fps = 30;
const frame = Math.floor(2.5 * fps) % (anim.frameCount + 1);
function skinLayoutA() {
  const nb = mesh.bones.length;
  const bindWorld = new Array(nb), bindInv = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const parent = mesh.bones[b].parent;
    const local = mesh.bones[b].bind;
    bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? r._matMulRow(bindWorld[parent], local) : local;
  }
  for (let b = 0; b < nb; b++) bindInv[b] = r._matInvertRow(bindWorld[b]);
  const animLocal = new Array(nb), animWorld = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const segStart = anim.segs[b];
    const rot = (2 * b) % 9;
    const o2 = segStart + frame * 36 + rot * 4;
    const px = dv.getFloat32(o2, true);
    const py = dv.getFloat32(o2 + 4, true);
    let local;
    if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000) {
      local = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, px, py, 0, 1];
    } else {
      local = mesh.bones[b].bind;
    }
    animLocal[b] = local;
    const parent = mesh.bones[b].parent;
    animWorld[b] = parent >= 0 && parent < nb && animWorld[parent] ? r._matMulRow(animWorld[parent], local) : local;
  }
  const gBones = new Array(nb);
  for (let b = 0; b < nb; b++) gBones[b] = r._matMulRow(animWorld[b], bindInv[b]);
  const out = new Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i++) {
    const p = mesh.positions[i];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.blendWeights[i][k];
      if (w === 0) continue;
      const mm = gBones[mesh.blendIndices[i][k]] || gBones[0];
      x += (p[0] * mm[0] + p[1] * mm[4] + p[2] * mm[8] + mm[12]) * w;
      y += (p[0] * mm[1] + p[1] * mm[5] + p[2] * mm[9] + mm[13]) * w;
      z += (p[0] * mm[2] + p[1] * mm[6] + p[2] * mm[10] + mm[14]) * w;
    }
    out[i] = [x, y, z];
  }
  return out;
}
try {
  const a = bbox(skinLayoutA());
  console.log('布局A蒙皮: ' + JSON.stringify(a));
  const d = { dx: Math.abs(a.minX - bind.minX), dy: Math.abs(a.minY - bind.minY), dw: Math.abs(a.maxX - bind.maxX), dh: Math.abs(a.maxY - bind.maxY) };
  console.log('  与绑定差异: ' + JSON.stringify(d));
} catch (e) { console.log('布局A失败: ' + e.message); }

// 布局 B: 每骨骼段, 帧内偏移 0 (前 2 floats)
function skinLayoutB() {
  const nb = mesh.bones.length;
  const bindWorld = new Array(nb), bindInv = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const parent = mesh.bones[b].parent;
    const local = mesh.bones[b].bind;
    bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? r._matMulRow(bindWorld[parent], local) : local;
  }
  for (let b = 0; b < nb; b++) bindInv[b] = r._matInvertRow(bindWorld[b]);
  const animWorld = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const o2 = anim.segs[b] + frame * 36;
    const px = dv.getFloat32(o2, true);
    const py = dv.getFloat32(o2 + 4, true);
    let local;
    if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000) {
      local = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, px, py, 0, 1];
    } else local = mesh.bones[b].bind;
    const parent = mesh.bones[b].parent;
    animWorld[b] = parent >= 0 && parent < nb && animWorld[parent] ? r._matMulRow(animWorld[parent], local) : local;
  }
  const gBones = new Array(nb);
  for (let b = 0; b < nb; b++) gBones[b] = r._matMulRow(animWorld[b], bindInv[b]);
  const out = new Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i++) {
    const p = mesh.positions[i];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.blendWeights[i][k];
      if (w === 0) continue;
      const mm = gBones[mesh.blendIndices[i][k]] || gBones[0];
      x += (p[0] * mm[0] + p[1] * mm[4] + p[2] * mm[8] + mm[12]) * w;
      y += (p[0] * mm[1] + p[1] * mm[5] + p[2] * mm[9] + mm[13]) * w;
      z += (p[0] * mm[2] + p[1] * mm[6] + p[2] * mm[10] + mm[14]) * w;
    }
    out[i] = [x, y, z];
  }
  return out;
}
try {
  const b2 = bbox(skinLayoutB());
  console.log('布局B蒙皮: ' + JSON.stringify(b2));
} catch (e) { console.log('布局B失败: ' + e.message); }
