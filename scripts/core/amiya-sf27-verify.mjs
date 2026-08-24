// 验证 sf27 视图平移: 各组件画布位置 (含 -eye 平移)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
r._setupCamera();
console.log('camEye =', r.camEye);
const ortho = r.scene.general.orthogonalprojection;
const ps = [r.W / ortho.width, r.H / (ortho.height || 1080)];
console.log('ps =', ps, 'ortho =', ortho.width, 'x', ortho.height);
// 组件画布中心 (中心锚定, y 向下画布)
for (const id of [314, 697, 459, 295, 407, 361, 509, 421, 685]) {
  const o = r.objects.find(x => x.id === id);
  if (!o) continue;
  const tr = r.resolveTransform(o);
  const m = o.image ? r.readJsonAny(o.image) : null;
  const size = parseSize(o.size);
  const vs = r._viewShift(o, size, ps);
  const cx = tr.origin[0] * ps[0] + vs[0];
  const cy = tr.origin[1] * ps[1] + vs[1];
  const cvx = tr.origin[0] * ps[0], cvy = tr.origin[1] * ps[1];
  console.log(`${id} "${o.name}" type=${m && m.puppet ? 'puppet' : 'image'} size=${size} 无视图中心=(${cvx.toFixed(1)},${cvy.toFixed(1)}) → 含视图=(${cx.toFixed(1)},${cy.toFixed(1)}) shift=(${vs[0].toFixed(1)},${vs[1].toFixed(1)})`);
}
function parseSize(s) {
  if (!s) return [0, 0];
  const p = String(s).trim().split(/\s+/).map(Number);
  return [p[0] || 0, p[1] || 0];
}
