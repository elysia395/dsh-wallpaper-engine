// 验证 fps 对头形位置的影响: 动画1 (120帧) 不同帧索引的头形
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const mesh = r._parseMdl(r.pkg.read(m.puppet));
const anim1 = mesh.animations[1];

// 不同 fps 下的帧索引
console.log('动画1 frames=' + anim1.frameCount);
for (const fps of [30, 60, 24, 15, 48]) {
  const frame = Math.floor(2.5 * fps) % anim1.frameCount;
  console.log(`fps=${fps} → 帧 ${frame}`);
}

// 指定帧蒙皮: 用 _skinPuppet 但改 t 使帧匹配
function skinAtFrame(animIdx, frame) {
  const mesh2 = r._parseMdl(r.pkg.read(m.puppet));
  // 用 t 使 floor(t*fps)%frameCount = frame
  // 直接 patch: _skinPuppet 用 frame
  const origSkin = r._skinPuppet.bind(r);
  let targetFrame = frame;
  const origParse = r._parseMdl.bind(r);
  const dv = new DataView(mesh2.raw.buffer, mesh2.raw.byteOffset, mesh2.raw.byteLength);
  // 手动蒙皮指定帧 (复制 _skinPuppet 逻辑但用指定 frame)
  const nb = mesh2.bones.length;
  const bindWorld = new Array(nb), bindInv = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const parent = mesh2.bones[b].parent;
    bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? r._matMulRow(bindWorld[parent], mesh2.bones[b].bind) : mesh2.bones[b].bind;
  }
  for (let b = 0; b < nb; b++) bindInv[b] = r._matInvertRow(bindWorld[b]);
  const anim = mesh2.animations[animIdx];
  const totalFrames = Math.max(1, anim.frameCount);
  const animWorld = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const segStart = anim.segs[b];
    const b2 = 2 * b;
    const posShift = Math.floor(b2 / 9);
    const posCol = b2 % 9;
    const o1 = segStart + ((targetFrame + posShift) % totalFrames) * 36 + posCol * 4;
    const px = dv.getFloat32(o1, true), py = dv.getFloat32(o1 + 4, true);
    const rotShift = Math.floor((b2 + 5) / 9);
    const rotCol = (b2 + 5) % 9;
    const o2 = segStart + ((targetFrame + posShift + rotShift) % totalFrames) * 36 + rotCol * 4;
    const rotZ = dv.getFloat32(o2, true);
    let local;
    if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000 && isFinite(rotZ)) {
      const c = Math.cos(rotZ), s = Math.sin(rotZ);
      local = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, px, py, 0, 1];
    } else local = mesh2.bones[b].bind;
    const parent = mesh2.bones[b].parent;
    animWorld[b] = parent >= 0 && parent < nb && animWorld[parent] ? r._matMulRow(animWorld[parent], local) : local;
  }
  const gBones = new Array(nb);
  for (let b = 0; b < nb; b++) gBones[b] = r._matMulRow(animWorld[b], bindInv[b]);
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
    out[i] = [x, y, z];
  }
  return out;
}

const screen = (sk) => {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const p of sk) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  const x0 = (885 + a) * 0.5, x1 = (885 + c) * 0.5;
  const y0 = 1080 - (800 + d) * 0.5, y1 = 1080 - (800 + b) * 0.5;
  return [(x0 + x1) / 2, (y0 + y1) / 2];
};
const eyeMid = [425.5, 670.75];
for (const frame of [0, 30, 60, 75, 90, 119]) {
  const sk = skinAtFrame(1, frame);
  const c = screen(sk);
  console.log(`动画1 帧${frame}: 头形中心(${c[0].toFixed(1)},${c[1].toFixed(1)}) dx=${(c[0] - eyeMid[0]).toFixed(1)} dy=${(c[1] - eyeMid[1]).toFixed(1)}`);
}
