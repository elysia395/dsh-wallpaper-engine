// Debug: 新布局 frame=0 蒙皮, 对比 animWorld vs bindWorld
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
const nb = mesh.bones.length;

const bindWorld = new Array(nb), bindInv = new Array(nb);
for (let b = 0; b < nb; b++) {
  const parent = mesh.bones[b].parent;
  bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? r._matMulRow(bindWorld[parent], mesh.bones[b].bind) : mesh.bones[b].bind;
}
for (let b = 0; b < nb; b++) bindInv[b] = r._matInvertRow(bindWorld[b]);

const frame = 0;
const animWorld = new Array(nb);
for (let b = 0; b < nb; b++) {
  const rot = (2 * b) % 9;
  const shift = Math.floor(2 * b / 9);
  const o2 = anim.segs[b] + ((frame + shift) % (anim.frameCount + 1)) * 36 + rot * 4;
  const px = dv.getFloat32(o2, true), py = dv.getFloat32(o2 + 4, true);
  let local;
  if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000) local = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, px, py, 0, 1];
  else local = mesh.bones[b].bind;
  const parent = mesh.bones[b].parent;
  animWorld[b] = parent >= 0 && parent < nb && animWorld[parent] ? r._matMulRow(animWorld[parent], local) : local;
}
for (const b of [0, 7, 13, 24, 25, 31]) {
  const aw = animWorld[b], bw = bindWorld[b];
  const d = [aw[0]-bw[0], aw[5]-bw[5], aw[10]-bw[10], aw[12]-bw[12], aw[13]-bw[13]].map(v => v.toFixed(4));
  console.log(`B${b} animWorld vs bindWorld 差异(00,11,22,tx,ty): ${d.join(' ')}`);
}
// 顶点 0 变换
const v0 = mesh.positions[0];
const gBones = new Array(nb);
for (let b = 0; b < nb; b++) gBones[b] = r._matMulRow(animWorld[b], bindInv[b]);
let x=0,y=0,z=0;
for (let k = 0; k < 4; k++) {
  const w = mesh.blendWeights[0][k]; if (w === 0) continue;
  const mm = gBones[mesh.blendIndices[0][k]] || gBones[0];
  x += (v0[0]*mm[0] + v0[1]*mm[4] + v0[2]*mm[8] + mm[12]) * w;
  y += (v0[0]*mm[1] + v0[1]*mm[5] + v0[2]*mm[9] + mm[13]) * w;
}
console.log('顶点0 新布局蒙皮: (' + x.toFixed(2) + ',' + y.toFixed(2) + ') 原始 (' + v0.join(',') + ')');
