// 通用组件内容 bbox 检查: node scripts/core/component-bbox.mjs <wallId> [ids...]
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { getVal, parseVec2 } from '../../lib/we-renderer/math.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = process.argv[2] || '3655429099';
const T = 2.5;
const targets = process.argv.slice(3).map(Number);

const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: T, weAssetsDir: WE, log: () => {} });
const W = r.W, H = r.H;
const sceneW = r.scene.general.orthogonalprojection.width, sceneH = r.scene.general.orthogonalprojection.height;
const ps = [W / sceneW, H / sceneH];

for (const o of r.objects) {
  if (targets.length && !targets.includes(o.id)) continue;
  if (!o.image) continue;
  const saveVisible = new Map();
  for (const oo of r.objects) { saveVisible.set(oo.id, oo.visible); oo.visible = false; }
  const target = r.objects.find(oo => oo.id === o.id);
  target.visible = true;
  r.render();
  const d = r.canvas.data;
  let minX = W, minY = H, maxX = -1, maxY = -1, nz = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3] > 10) { nz++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  for (const [oid, v] of saveVisible) {
    const obj = r.objects.find(oo => oo.id === oid);
    if (obj) obj.visible = v;
  }
  let size = parseVec2(getVal(o, 'size'), [0, 0]);
  const m = o.image ? r.readJsonAny(o.image) : null;
  if (size[0] === 0 && m) { const t = r.loadModelTexture(o.image); if (t) size = [t.width, t.height]; }
  const tr = r.resolveTransform(o);
  const dw = size[0] * tr.scale[0] * ps[0], dh = size[1] * tr.scale[1] * ps[1];
  let dx = tr.origin[0] * ps[0] - dw / 2, dy = H - tr.origin[1] * ps[1] - dh / 2;
  const al = String(getVal(o, 'alignment', '')).toLowerCase();
  if (al.includes('top')) dy += dh/2; else if (al.includes('bottom')) dy -= dh/2;
  if (al.includes('left')) dx += dw/2; else if (al.includes('right')) dx -= dw/2;
  const has = nz > 0;
  console.log(`${String(o.id).padEnd(5)} ${String(o.name || '').padEnd(12)} 内容=${has ? `${minX},${minY}..${maxX},${maxY}(${maxX-minX+1}x${maxY-minY+1})` : '无'} 像素${nz} | size矩形=${dx.toFixed(0)},${dy.toFixed(0)},${dw.toFixed(0)},${dh.toFixed(0)}${m && m.puppet ? ' P' : ''}`);
}
