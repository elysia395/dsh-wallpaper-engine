// 全面验证: 问题壁纸所有 image/puppet 组件内容 bbox 是否在 size 矩形内
// 用法: node scripts/core/audit-all-puppets.mjs
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { getVal, parseVec2 } from '../../lib/we-renderer/math.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const T = 2.5;
const ids = ['3486806915', '3655429099', '3629379075', '3554161528', '3641860575', '3461168300', '3690417937', '3582367840'];

for (const id of ids) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: T, weAssetsDir: WE, log: () => {} });
  const sceneW = r.scene.general.orthogonalprojection.width, sceneH = r.scene.general.orthogonalprojection.height;
  const ps = [r.W / sceneW, r.H / sceneH];
  let puppetCount = 0, puppetOutside = 0;
  for (const o of r.objects) {
    if (!o.image) continue;
    const m = o.image ? r.readJsonAny(o.image) : null;
    if (!m || !m.puppet) continue;
    puppetCount++;
    // 单独渲染
    const saveVis = new Map();
    for (const oo of r.objects) { saveVis.set(oo.id, oo.visible); oo.visible = false; }
    o.visible = true;
    r.render();
    const d = r.canvas.data;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, nz = 0;
    for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
      const i = (y * r.W + x) * 4;
      if (d[i + 3] > 10) { nz++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    for (const [oid, v] of saveVis) { const obj = r.objects.find(x => x.id === oid); if (obj) obj.visible = v; }
    // size 矩形
    let size = parseVec2(getVal(o, 'size'), [0, 0]);
    if (size[0] === 0 || size[1] === 0) { const t = r.loadModelTexture(o.image); if (t) size = [t.width, t.height]; }
    const tr = r.resolveTransform(o);
    const dw = size[0] * tr.scale[0] * ps[0], dh = size[1] * tr.scale[1] * ps[1];
    let dx = tr.origin[0] * ps[0] - dw / 2, dy = r.H - tr.origin[1] * ps[1] - dh / 2;
    const al = String(getVal(o, 'alignment', '')).toLowerCase();
    if (al.includes('top')) dy += dh / 2; else if (al.includes('bottom')) dy -= dh / 2;
    if (al.includes('left')) dx += dw / 2; else if (al.includes('right')) dx -= dw / 2;
    if (nz === 0) { console.log(`${id} ${o.name || o.id} [${o.id}] puppet 无内容`); continue; }
    // 内容与 size 矩形重叠比
    const ox0 = Math.max(minX, dx), oy0 = Math.max(minY, dy), ox1 = Math.min(maxX, dx + dw), oy1 = Math.min(maxY, dy + dh);
    const inter = Math.max(0, ox1 - ox0) * Math.max(0, oy1 - oy0);
    const area = (maxX - minX + 1) * (maxY - minY + 1);
    const ratio = area ? inter / area : 0;
    const status = ratio > 0.5 ? 'OK' : (ratio > 0 ? 'PART' : 'OUT');
    if (status !== 'OK') puppetOutside++;
    console.log(`${id} ${String(o.name || o.id).padEnd(10)} [${o.id}] ${status} 内容(${minX},${minY}..${maxX},${maxY}) sizeRect(${dx.toFixed(0)},${dy.toFixed(0)},${dw.toFixed(0)},${dh.toFixed(0)}) 重叠${(ratio * 100).toFixed(0)}%`);
  }
  console.log(`${id}: puppet ${puppetCount} 个, 非OK ${puppetOutside}`);
}
