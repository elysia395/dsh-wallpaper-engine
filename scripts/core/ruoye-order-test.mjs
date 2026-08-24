// 若叶睦顺序测试: 书/手臂 vs 头的渲染顺序
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3629379075';

function make(mode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (mode !== 'array') {
    const depth = (o) => {
      let d = 0, cur = o, guard = 0;
      while (cur.parent != null && guard < 30) {
        const p = r.objects.find(x => x.id === cur.parent);
        if (!p) break;
        cur = p; d++; guard++;
      }
      return d;
    };
    const arrIdx = new Map(r.objects.map((o, i) => [o.id, i]));
    let order = [...r.objects].sort((a, b) => (depth(b) - depth(a)) || (arrIdx.get(a.id) - arrIdx.get(b.id)));
    if (mode === 'deep-first-bg-first') {
      order = [...order.filter(o => o.id === 165), ...order.filter(o => o.id !== 165)];
    } else if (mode === 'deep-last-bg-first') {
      order = [...order.filter(o => o.id === 165), ...order.filter(o => o.id !== 165).sort((a, b) => (depth(a) - depth(b)) || (arrIdx.get(a.id) - arrIdx.get(b.id)))];
    }
    r.renderOrder = order.filter(o => ['image', 'model', 'particle', 'text'].includes(o._renderType));
  }
  r.render();
  return r;
}

// 组件内容可见性 (区域非透明) — 头区域 vs 书区域
function regionContent(r, x0, y0, x1, y1) {
  const d = r.canvas.data;
  let nz = 0, total = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    total++;
    if (d[(y * r.W + x) * 4 + 3] > 10) nz++;
  }
  return (nz / total * 100).toFixed(0);
}
// 书区域 (423,220..538,375), 头区域 (421,181..553,339), 手臂 (371,244..608,400)
for (const mode of ['array', 'deep-first-bg-first', 'deep-last-bg-first']) {
  try {
    const r = make(mode);
    console.log(`${mode}: 头区域 ${regionContent(r, 421, 181, 553, 339)}% 书区域 ${regionContent(r, 423, 220, 538, 375)}% 手臂区域 ${regionContent(r, 371, 244, 608, 400)}%`);
  } catch (e) { console.log(mode + ': ERR ' + e.message); }
}
