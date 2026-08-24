// blend 混合测试: 动画层 blend 语义 (pos/rot 插值混合)
// 假设: 可见层动画 × blend + 绑定姿态 × (1-blend) — 骨骼 pos/rot 插值
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

// 混合蒙皮: animLocal = T(lerp(bindPos, animPos, b)) × Rz(lerp(bindRot, animRot, b))
function skinBlend(mesh, t, blend, animIdx) {
  const dv = new DataView(mesh.raw.buffer, mesh.raw.byteOffset, mesh.raw.byteLength);
  const anim = mesh.animations[animIdx];
  const nb = mesh.bones.length;
  const fps = 30;
  const frame = Math.floor(t * fps) % Math.max(1, anim.frameCount);
  const totalFrames = Math.max(1, anim.frameCount);
  // 绑定矩阵分解 (平移 + rot)
  const bindP = [], bindR = [];
  for (let b = 0; b < nb; b++) {
    const m = mesh.bones[b].bind;
    bindP.push([m[12], m[13]]);
    bindR.push(Math.atan2(m[1], m[0])); // bind[1]=sin, bind[0]=cos
  }
  // 动画局部矩阵 (pos/rot)
  const bindWorld = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const parent = mesh.bones[b].parent;
    bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? this._matMulRow(bindWorld[parent], mesh.bones[b].bind) : mesh.bones[b].bind;
  }
  // 动画世界矩阵: 混合 pos/rot
  const animWorld = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const b2 = 2 * b;
    const posShift = Math.floor(b2 / 9);
    const posCol = b2 % 9;
    const o1 = anim.segs[b] + ((frame + posShift) % totalFrames) * 36 + posCol * 4;
    const px = dv.getFloat32(o1, true), py = dv.getFloat32(o1 + 4, true);
    const rotShift = Math.floor((b2 + 5) / 9);
    const rotCol = (b2 + 5) % 9;
    const o2 = anim.segs[b] + ((frame + posShift + rotShift) % totalFrames) * 36 + rotCol * 4;
    const rot = dv.getFloat32(o2, true);
    // 混合: 绑定姿态时 pos=绑定, rot=绑定rot → 混合 = 绑定
    const useBind = !(isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000 && isFinite(rot));
    const mixPos = useBind ? bindP[b] : [bindP[b][0] + (px - bindP[b][0]) * blend, bindP[b][1] + (py - bindP[b][1]) * blend];
    const mixRot = useBind ? bindR[b] : bindR[b] + (rot - bindR[b]) * blend;
    const c = Math.cos(mixRot), s = Math.sin(mixRot);
    const local = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, mixPos[0], mixPos[1], 0, 1];
    const parent = mesh.bones[b].parent;
    animWorld[b] = parent >= 0 && parent < nb && animWorld[parent] ? this._matMulRow(animWorld[parent], local) : local;
  }
  // 蒙皮
  const gBones = new Array(nb);
  for (let b = 0; b < nb; b++) gBones[b] = this._matMulRow(animWorld[b], this._matInvertRow(bindWorld[b]));
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

const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const mesh = r._parseMdl(r.pkg.read(m.puppet));
const bbox = (pts) => {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const p of pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  return { bbox: [a, b, c, d], center: [(a + c) / 2, (b + d) / 2] };
};
const screen = (bb, ps = 0.5) => {
  const ox = 885, oy = 800; // 头 origin 场景
  const x0 = (ox + bb.bbox[0]) * ps, x1 = (ox + bb.bbox[3]) * ps;
  const y0 = 1080 - (oy + bb.bbox[2]) * ps, y1 = 1080 - (oy + bb.bbox[1]) * ps;
  return { bbox: [x0, y0, x1, y1], center: [(x0 + x1) / 2, (y0 + y1) / 2] };
};
const eyeMid = [425.5, 670.75];
for (const [label, blend] of [['纯动画1', 1.0], ['blend 0.74', 0.74], ['blend 0.5', 0.5]]) {
  try {
    const sk = skinBlend.call(r, mesh, 2.5, blend, 1);
    const bb = bbox(sk);
    const sc = screen(bb);
    console.log(`${label}: 头形(${sc.bbox.map(v => v.toFixed(0)).join(',')}) 中心(${sc.center.map(v => v.toFixed(1)).join(',')})`);
    console.log(`  相对两眼中点 dx=${(sc.center[0] - eyeMid[0]).toFixed(1)} dy=${(sc.center[1] - eyeMid[1]).toFixed(1)}`);
  } catch (e) { console.log(`${label} ERR: ${e.message}`); }
}
