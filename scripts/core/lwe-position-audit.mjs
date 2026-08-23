// 文件级定位审计: 独立实现 lwe CImage.cpp 定位公式 (事实基准),
// 对比 SceneRenderer 内部公式 (resolveTransform + renderImage 定位),
// 逐组件输出差异 — 用户核心要求"基于文件的组件一一对应"。
// 用法: node scripts/core/lwe-position-audit.mjs <workshopId> [time]
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { getVal, parseVec2, parseVec3 } from '../../lib/we-renderer/math.js';
import { applySceneScripts } from '../../lib/scene-scripts.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = process.argv[2] || '3486806915';
const T = parseFloat(process.argv[3] || '2.5');

const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 3840, height: 2160, time: T, weAssetsDir: WE, log: () => {} });
// 先应用 scripts/动画, 使对象值为渲染时的实际值
r._backupScriptValues(); r._restoreScriptValues();
try { applySceneScripts(r.scene, T); } catch {}
try { r._resolveAnimations(T); } catch {}

const sceneW = (r.scene.general?.orthogonalprojection?.width) || 1920;
const sceneH = (r.scene.general?.orthogonalprojection?.height) || 1080;
const ps = [r.W / sceneW, r.H / sceneH];

// ── lwe 基准: CImage.cpp resolveTransform (111-168) ──
// localTransform: image → scale/angles; text → scale; group → groupScale/groupAngles(即 scale/angles)
// resolveTransform: 根 local, 子 origin × 祖先累积 scale → rotate(祖先累积 angle) → + 祖先 origin
function lweResolve(o, objectsById) {
  const chain = [o];
  let cur = o;
  let guard = 0;
  while (cur.parent != null && guard < 32) {
    const parent = objectsById.get(cur.parent);
    if (!parent) break;
    chain.push(parent);
    cur = parent;
    guard++;
  }
  const root = chain[chain.length - 1];
  const localOf = (obj) => {
    const origin = parseVec3(getVal(obj, 'origin'), [0, 0, 0]);
    const scale = parseVec3(getVal(obj, 'scale'), [1, 1, 1]);
    const angles = parseVec3(getVal(obj, 'angles'), [0, 0, 0]);
    return { origin, scale, angle: angles[2], angles };
  };
  let resolved = localOf(root);
  for (let i = chain.length - 2; i >= 0; i--) {
    const local = localOf(chain[i]);
    const c = Math.cos(resolved.angle), s = Math.sin(resolved.angle);
    const ox = local.origin[0] * resolved.scale[0] * c - local.origin[1] * resolved.scale[1] * s;
    const oy = local.origin[0] * resolved.scale[0] * s + local.origin[1] * resolved.scale[1] * c;
    local.origin[0] = resolved.origin[0] + ox;
    local.origin[1] = resolved.origin[1] + oy;
    local.origin[2] = resolved.origin[2] + local.origin[2] * resolved.scale[2];
    resolved = {
      origin: local.origin,
      scale: [local.scale[0] * resolved.scale[0], local.scale[1] * resolved.scale[1], local.scale[2] * resolved.scale[2]],
      angle: local.angle + resolved.angle,
      angles: local.angles,
    };
  }
  return resolved;
}

// ── lwe 基准: CImage.cpp 构造定位 (190-262) ──
// m_pos = origin ± scaledSize/2 (中心), alignment 调整, 中心化 (-scene/2, y 翻转)
function lweImageRect(o, tr) {
  let size = parseVec2(getVal(o, 'size'), [0, 0]);
  if (size[0] === 0 || size[1] === 0) {
    // getSize fallback: 纹理尺寸 — 用渲染器纹理 (可能解码失败, 跳过该组件)
    const tex = o.image ? r.loadModelTexture(o.image) : null;
    if (tex) size = [tex.width, tex.height];
    else return null;
  }
  const scaled = [size[0] * tr.scale[0], size[1] * tr.scale[1]];
  // 场景空间 (中心在 origin, y 向上)
  let left = tr.origin[0] - scaled[0] / 2;
  let right = tr.origin[0] + scaled[0] / 2;
  let bottom = tr.origin[1] - scaled[1] / 2;
  let top = tr.origin[1] + scaled[1] / 2;
  const align = String(getVal(o, 'alignment', '')).toLowerCase();
  if (align.includes('top')) { bottom -= scaled[1] / 2; top -= scaled[1] / 2; }
  else if (align.includes('bottom')) { bottom += scaled[1] / 2; top += scaled[1] / 2; }
  if (align.includes('left')) { left += scaled[0] / 2; right += scaled[0] / 2; }
  else if (align.includes('right')) { left -= scaled[0] / 2; right -= scaled[0] / 2; }
  // 中心化 (CImage.cpp:258-262)
  left -= sceneW / 2; right -= sceneW / 2;
  bottom = sceneH / 2 - bottom; top = sceneH / 2 - top;
  // 场景坐标 → 画布像素 (正交投影, 画布 = 全屏)
  const px = (x) => (x / (sceneW / 2)) * (r.W / 2) + r.W / 2;
  const py = (y) => (y / (sceneH / 2)) * (r.H / 2) + r.H / 2;
  return {
    x: px(left), y: py(top), w: px(right) - px(left), h: py(bottom) - py(top),
    sceneLeft: left, sceneTop: top, sceneRight: right, sceneBottom: bottom,
  };
}

// ── 我的管线公式 (renderImage 定位) ──
function myImageRect(o) {
  const tr = r.resolveTransform(o);
  let size = parseVec2(getVal(o, 'size'), [0, 0]);
  if ((size[0] === 0 || size[1] === 0)) {
    const tex = o.image ? r.loadModelTexture(o.image) : null;
    if (tex) size = [tex.width, tex.height];
    else return null;
  }
  const sc = tr.scale;
  const dw = size[0] * sc[0] * ps[0], dh = size[1] * sc[1] * ps[1];
  let dx = tr.origin[0] * ps[0] - dw / 2;
  let dy = r.H - tr.origin[1] * ps[1] - dh / 2;
  const align = String(getVal(o, 'alignment', '')).toLowerCase();
  // 与 core.js renderImage 一致 (lwe: top → 顶边下移 dh/2, bottom → 底边上移 dh/2)
  if (align.includes('top')) dy += dh / 2;
  else if (align.includes('bottom')) dy -= dh / 2;
  if (align.includes('left')) dx += dw / 2;
  else if (align.includes('right')) dx -= dw / 2;
  return { x: dx, y: dy, w: dw, h: dh };
}

const objectsById = new Map(r.scene.objects.map((o) => [o.id, o]));
const rows = [];
for (const o of r.scene.objects) {
  if (!o.image) continue;
  const name = String(o.name || o.id);
  const lweTr = lweResolve(o, objectsById);
  const lweR = lweImageRect(o, lweTr);
  const myR = myImageRect(o);
  if (!lweR || !myR) continue;
  const dx = Math.abs(lweR.x - myR.x), dy = Math.abs(lweR.y - myR.y);
  const dw = Math.abs(lweR.w - myR.w), dh = Math.abs(lweR.h - myR.h);
  const tol = 0.5;
  const ok = dx < tol && dy < tol && dw < tol && dh < tol;
  const inView = myR.x + myR.w > 0 && myR.x < r.W && myR.y + myR.h > 0 && myR.y < r.H;
  rows.push({
    name, id: o.id, ok, inView,
    lwe: [Math.round(lweR.x), Math.round(lweR.y), Math.round(lweR.w), Math.round(lweR.h)].join(','),
    my: [Math.round(myR.x), Math.round(myR.y), Math.round(myR.w), Math.round(myR.h)].join(','),
    diff: `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} dw=${dw.toFixed(1)} dh=${dh.toFixed(1)}`,
    align: String(getVal(o, 'alignment', '')),
  });
}

console.log(`场景 ${id} 画布 ${r.W}x${r.H} scene ${sceneW}x${sceneH} ps=${ps[0].toFixed(4)}`);
const bad = rows.filter((x) => !x.ok);
const out = rows.filter((x) => !x.inView);
console.log(`image 组件: ${rows.length}  公式不一致: ${bad.length}  画面外: ${out.length}`);
if (bad.length) {
  console.log('\n── 公式不一致组件 (lwe vs 我的) ──');
  bad.slice(0, 40).forEach((x) => console.log(`  ${x.name} [${x.id}] lwe=${x.lwe} my=${x.my} ${x.diff} align=${x.align}`));
}
if (out.length) {
  console.log('\n── 画面外组件 ──');
  out.slice(0, 40).forEach((x) => console.log(`  ${x.name} [${x.id}] my=${x.my} align=${x.align}`));
}
console.log('\n── 前 25 个组件定位 ──');
rows.slice(0, 25).forEach((x) => console.log(`  ${x.ok ? 'OK ' : 'BAD'} ${x.name} [${x.id}] my=${x.my} lwe=${x.lwe}`));
