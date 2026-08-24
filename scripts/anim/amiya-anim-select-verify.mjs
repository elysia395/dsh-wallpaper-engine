// 验证: animationlayers 动画选择 + 当前 MDLA 布局 → 头形与眼睛/头发相对位置
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mesh = r._parseMdl(buf);

console.log('MDL 动画: ' + (mesh.animations || []).length + ' 个');
(mesh.animations || []).forEach((a, i) => console.log(`  动画${i}: frames=${a.frameCount} bones=${a.boneCount} segBytes=${a.segBytes}`));

const bbox = (pts) => {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const p of pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  return `x[${a.toFixed(1)},${c.toFixed(1)}] y[${b.toFixed(1)},${d.toFixed(1)}]`;
};

// 绑定姿态
console.log('绑定: ' + bbox(mesh.positions));
// 动画0 (当前)
console.log('动画0: ' + bbox(r._skinPuppet(mesh, 2.5, 0, 0)));
// 动画1 (animationlayers 层2 呼吸循环)
const mesh1 = r._parseMdl(buf);
mesh1.animations = [mesh1.animations[1]];
console.log('动画1: ' + bbox(r._skinPuppet(mesh1, 2.5, 0, 0)));

// 混合: 动画1×blend + 绑定×(1-blend) — 骨骼矩阵插值
function skinBlend(animIdx, blend, t) {
  const m2 = r._parseMdl(buf);
  const anim = m2.animations[animIdx];
  const nb = m2.bones.length;
  const fps = 30;
  const frame = Math.floor(t * fps) % Math.max(1, anim.frameCount);
  // 绑定世界
  const bindWorld = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const parent = m2.bones[b].parent;
    bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? r._matMulRow(bindWorld[parent], m2.bones[b].bind) : m2.bones[b].bind;
  }
  // 动画世界 (用布局公式)
  const totalFrames = Math.max(1, anim.frameCount);
  const animWorld = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const segStart = anim.segs[b];
    const b2 = 2 * b;
    const posShift = Math.floor(b2 / 9);
    const posCol = b2 % 9;
    const o1 = segStart + ((frame + posShift) % totalFrames) * 36 + posCol * 4;
    const px = dv.getFloat32(o1, true), py = dv.getFloat32(o1 + 4, true);
    const rotShift = Math.floor((b2 + 5) / 9);
    const rotCol = (b2 + 5) % 9;
    const o2 = segStart + ((frame + posShift + rotShift) % totalFrames) * 36 + rotCol * 4;
    const rotZ = dv.getFloat32(o2, true);
    let local;
    if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000 && isFinite(rotZ)) {
      const c = Math.cos(rotZ), s = Math.sin(rotZ);
      local = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, px, py, 0, 1];
    } else local = m2.bones[b].bind;
    const parent = m2.bones[b].parent;
    animWorld[b] = parent >= 0 && parent < nb && animWorld[parent] ? r._matMulRow(animWorld[parent], local) : local;
  }
  // 混合: lerp(bindWorld, animWorld, blend) — 平移+旋转插值 (简化: 矩阵分量 lerp)
  const out = new Array(m2.positions.length);
  for (let i = 0; i < m2.positions.length; i++) {
    const p = m2.positions[i];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = m2.blendWeights[i][k];
      if (w === 0) continue;
      const bi = m2.blendIndices[i][k];
      const bw = bindWorld[bi] || bindWorld[0];
      const aw = animWorld[bi] || animWorld[0];
      // 混合矩阵 (分量 lerp — 近似, 仅验证位置趋势)
      const mm = bw.map((v, j) => v + (aw[j] - v) * blend);
      x += (p[0] * mm[0] + p[1] * mm[4] + p[2] * mm[8] + mm[12]) * w;
      y += (p[0] * mm[1] + p[1] * mm[5] + p[2] * mm[9] + mm[13]) * w;
      z += (p[0] * mm[2] + p[1] * mm[6] + p[2] * mm[10] + mm[14]) * w;
    }
    out[i] = [x, y, z];
  }
  return out;
}
// 混合 0.74 (层2 blend)
try { console.log('动画1×0.74混合: ' + bbox(skinBlend(1, 0.74, 2.5))); } catch (e) { console.log('混合失败: ' + e.message); }

// 渲染对比: 头形内容 (动画0 vs 动画1 vs 混合)
for (const [label, animIdx, blend] of [['动画0', 0, 1], ['动画1', 1, 1], ['动画1×0.74', 1, 0.74]]) {
  const r2 = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  const origParse = r2._parseMdl.bind(r2);
  r2._parseMdl = (buf2) => {
    const mesh2 = origParse(buf2);
    if (mesh2 && mesh2.animations && mesh2.animations.length > 1 && mesh2._animIdx != null) {
      mesh2.animations = [mesh2.animations[mesh2._animIdx]];
    }
    return mesh2;
  };
  // 头 mesh 用指定动画
  const headO = r2.objects.find(x => x.id === 697);
  // 直接在缓存后改: 渲染头时指定
  const origRP = r2.renderPuppet.bind(r2);
  r2.renderPuppet = (o2, model, tr, t) => {
    const mesh2 = r2._mdlCache.get(model.puppet);
    if (mesh2 && o2.id === 697 && mesh2.animations && mesh2.animations.length > 1) {
      mesh2.animations = [mesh2.animations[animIdx]];
      if (blend < 1) mesh2._blend = blend;
    }
    return origRP(o2, model, tr, t);
  };
  // 单独渲染头
  const sv = new Map();
  for (const oo of r2.objects) { sv.set(oo.id, oo.visible); oo.visible = false; }
  headO.visible = true;
  r2.render();
  const d = r2.canvas.data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, nz = 0;
  for (let y = 0; y < r2.H; y++) for (let x = 0; x < r2.W; x++) {
    const i = (y * r2.W + x) * 4;
    if (d[i + 3] > 10) { nz++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  for (const [oid, v] of sv) { const obj = r2.objects.find(x => x.id === oid); if (obj) obj.visible = v; }
  console.log(`${label} 头形内容: ${nz ? minX + ',' + minY + '..' + maxX + ',' + maxY : '无'}`);
}
// 眼睛位置参照 (动画无关)
console.log('右眼(参照): (445,669..477,700) 左眼: (361,639..419,675) 左耳: (360,352..519,548) [1920下]');
