// 骨骼矩阵约定变体测试: rot 符号/顶点变换 对头形位置的影响
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mesh = r._parseMdl(buf);
const anim = mesh.animations[1]; // 动画1 呼吸循环
const nb = mesh.bones.length;

// 变体蒙皮: mode 控制 rot 符号/顶点变换
function skinVariant(mode) {
  const fps = 30;
  const frame = Math.floor(2.5 * fps) % Math.max(1, anim.frameCount);
  const totalFrames = Math.max(1, anim.frameCount);
  const bindWorld = new Array(nb), bindInv = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const parent = mesh.bones[b].parent;
    bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? r._matMulRow(bindWorld[parent], mesh.bones[b].bind) : mesh.bones[b].bind;
  }
  for (let b = 0; b < nb; b++) bindInv[b] = r._matInvertRow(bindWorld[b]);
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
      if (mode === 'rot-inv') local = [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, px, py, 0, 1]; // rot 符号反
      else if (mode === 'rot-trans') local = [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, px, py, 0, 1]; // 转置 (行主序)
      else local = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, px, py, 0, 1]; // 默认
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
      if (mode === 'col-vec') {
        // 列向量左乘: M × [x,y,z,1]^T
        x += (mm[0] * p[0] + mm[1] * p[1] + mm[2] * p[2] + mm[3]) * w;
        y += (mm[4] * p[0] + mm[5] * p[1] + mm[6] * p[2] + mm[7]) * w;
        z += (mm[8] * p[0] + mm[9] * p[1] + mm[10] * p[2] + mm[11]) * w;
      } else {
        x += (p[0] * mm[0] + p[1] * mm[4] + p[2] * mm[8] + mm[12]) * w;
        y += (p[0] * mm[1] + p[1] * mm[5] + p[2] * mm[9] + mm[13]) * w;
        z += (p[0] * mm[2] + p[1] * mm[6] + p[2] * mm[10] + mm[14]) * w;
      }
    }
    out[i] = [x, y, z];
  }
  return out;
}

const screen = (sk) => {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const p of sk) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  const x0 = (885 + a) * 0.5, x1 = (885 + c) * 0.5;
  const y0 = 1080 - (800 + d) * 0.5, y1 = 1080 - (800 + b) * 0.5;
  return { bbox: [x0, y0, x1, y1], center: [(x0 + x1) / 2, (y0 + y1) / 2] };
};
const eyeMid = [425.5, 670.75];
for (const mode of ['默认', 'rot-inv', 'col-vec']) {
  try {
    const sk = skinVariant(mode);
    const sc = screen(sk);
    console.log(`${mode}: 头形(${sc.bbox.map(v => v.toFixed(0)).join(',')}) 中心(${sc.center.map(v => v.toFixed(1)).join(',')}) dx=${(sc.center[0] - eyeMid[0]).toFixed(1)} dy=${(sc.center[1] - eyeMid[1]).toFixed(1)}`);
  } catch (e) { console.log(`${mode} ERR: ${e.message}`); }
}
