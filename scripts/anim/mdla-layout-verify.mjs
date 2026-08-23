// 用解明的 MDLA 布局蒙皮 Hina 人物, 验证 bbox 合理 + 与绑定姿态对比
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3554161528/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 66);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mesh = r._parseMdl(buf);
const anim = mesh.animations[0];

const bbox = (pts) => { let a=1e9,b=1e9,c=-1e9,d=-1e9; for (const p of pts){a=Math.min(a,p[0]);b=Math.min(b,p[1]);c=Math.max(c,p[0]);d=Math.max(d,p[1]);} return `x[${a.toFixed(1)},${c.toFixed(1)}] y[${b.toFixed(1)},${d.toFixed(1)}]`; };
console.log('绑定姿态: ' + bbox(mesh.positions));

function skinWithLayout(t, useLayout) {
  const nb = mesh.bones.length;
  const bindWorld = new Array(nb), bindInv = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const parent = mesh.bones[b].parent;
    const local = mesh.bones[b].bind;
    bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? r._matMulRow(bindWorld[parent], local) : local;
  }
  for (let b = 0; b < nb; b++) bindInv[b] = r._matInvertRow(bindWorld[b]);
  const fps = 30;
  const frame = Math.floor(t * fps) % (anim.frameCount + 1);
  const animLocal = new Array(nb), animWorld = new Array(nb);
  for (let b = 0; b < nb; b++) {
    let px, py;
    if (useLayout) {
      const rot = (2 * b) % 9;
      const shift = Math.floor(2 * b / 9);
      const segStart = anim.segs[b];
      const o2 = segStart + ((frame + shift) % (anim.frameCount + 1)) * 36 + rot * 4;
      px = dv.getFloat32(o2, true);
      py = dv.getFloat32(o2 + 4, true);
    } else {
      const segStart = anim.segs[b];
      const o2 = segStart + frame * 36 + b * 2 * 4;
      px = dv.getFloat32(o2, true);
      py = dv.getFloat32(o2 + 4, true);
    }
    let local;
    if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000) {
      local = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, px, py, 0, 1];
    } else local = mesh.bones[b].bind;
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

for (const t of [0, 0.5, 1.0, 2.5]) {
  const a = skinWithLayout(t, true);
  console.log(`布局(新) t=${t}: ${bbox(a)}`);
}
console.log('---');
for (const t of [0, 2.5]) {
  const b = skinWithLayout(t, false);
  console.log(`布局(旧) t=${t}: ${bbox(b)}`);
}
// 渲染对比: 用新布局渲染单组件
const r2 = new SceneRenderer(`${WS}/3554161528/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
const o2 = r2.objects.find(x => x.id === 66);
const saveVis = new Map();
for (const oo of r2.objects) { saveVis.set(oo.id, oo.visible); oo.visible = false; }
o2.visible = true;
// patch _skinPuppet 用新布局
const origSkin = r2._skinPuppet.bind(r2);
r2._skinPuppet = (mesh2, t2, cxs, cys) => {
  // 用解明布局
  const anim2 = mesh2.animations[0];
  const dv2 = new DataView(mesh2.raw.buffer, mesh2.raw.byteOffset, mesh2.raw.byteLength);
  const nb = mesh2.bones.length;
  const bindWorld = new Array(nb), bindInv = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const parent = mesh2.bones[b].parent;
    const local = mesh2.bones[b].bind;
    bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? r2._matMulRow(bindWorld[parent], local) : local;
  }
  for (let b = 0; b < nb; b++) bindInv[b] = r2._matInvertRow(bindWorld[b]);
  const fps = 30;
  const frame = Math.floor(t2 * fps) % (anim2.frameCount + 1);
  const animWorld = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const rot = (2 * b) % 9;
    const shift = Math.floor(2 * b / 9);
    const o3 = anim2.segs[b] + ((frame + shift) % (anim2.frameCount + 1)) * 36 + rot * 4;
    const px = dv2.getFloat32(o3, true), py = dv2.getFloat32(o3 + 4, true);
    let local;
    if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000) local = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, px, py, 0, 1];
    else local = mesh2.bones[b].bind;
    const parent = mesh2.bones[b].parent;
    animWorld[b] = parent >= 0 && parent < nb && animWorld[parent] ? r2._matMulRow(animWorld[parent], local) : local;
  }
  const gBones = new Array(nb);
  for (let b = 0; b < nb; b++) gBones[b] = r2._matMulRow(animWorld[b], bindInv[b]);
  const out = new Array(mesh2.positions.length);
  for (let i = 0; i < mesh2.positions.length; i++) {
    const p = mesh2.positions[i];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh2.blendWeights[i][k];
      if (w === 0) continue;
      const mm = gBones[mesh2.blendIndices[i][k]] || gBones[0];
      x += (p[0] * mm[0] + p[1] * mm[4] + p[2] * mm[8] + mm[12]) * w;
      y += (p[0] * mm[1] + p[1] * mm[5] + p[2] * mm[9] + mm[13]) * w;
      z += (p[0] * mm[2] + p[1] * mm[6] + p[2] * mm[10] + mm[14]) * w;
    }
    out[i] = [x + cxs, y + cys, z];
  }
  return out;
};
r2.render();
const d = r2.canvas.data;
let minX=1e9,minY=1e9,maxX=-1,maxY=-1,nz=0;
for (let y = 0; y < r2.H; y++) for (let x = 0; x < r2.W; x++) {
  const i = (y * r2.W + x) * 4;
  if (d[i+3] > 10) { nz++; if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
}
console.log(`新布局渲染内容 bbox: ${minX},${minY}..${maxX},${maxY} 像素${nz}`);
