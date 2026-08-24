// Amiya 深度排序完整测试: 直接构造深度排序 renderOrder 渲染, 测头覆盖
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function makeWithOrder(orderFn) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
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
  const order = [...r.objects].sort(orderFn(depth, arrIdx));
  r.renderOrder = order.filter(o => ['image', 'model', 'particle', 'text'].includes(o._renderType));
  r.render();
  return r;
}

function headCoverage(r) {
  // 对比版本: 跳过躯干/大衣
  const r2 = makeWithOrder(() => (a, b) => 0); // 原始顺序
  for (const o of r2.objects) if ([449, 407, 403].includes(o.id)) o.visible = false;
  r2.render();
  const dA = r.canvas.data, dB = r2.canvas.data;
  let covered = 0, total = 0;
  for (let y = 266; y <= 412; y++) for (let x = 158; x <= 267; x++) {
    const i = (y * r.W + x) * 4;
    const aA = dA[i + 3], aB = dB[i + 3];
    const diff = Math.abs(dA[i] - dB[i]) + Math.abs(dA[i+1] - dB[i+1]) + Math.abs(dA[i+2] - dB[i+2]);
    if (aA > 0 && (aB === 0 || diff > 60)) covered++;
    total++;
  }
  return (covered / total * 100).toFixed(1);
}

const modes = {
  'array': () => (a, b) => 0,
  'deep-first': (depth, arrIdx) => (a, b) => (depth(b) - depth(a)) || (arrIdx.get(a.id) - arrIdx.get(b.id)),
  'deep-last': (depth, arrIdx) => (a, b) => (depth(a) - depth(b)) || (arrIdx.get(a.id) - arrIdx.get(b.id)),
  'deep-first-rev': (depth, arrIdx) => (a, b) => (depth(b) - depth(a)) || (arrIdx.get(b.id) - arrIdx.get(a.id)),
};
for (const [name, fn] of Object.entries(modes)) {
  try {
    const r = makeWithOrder(fn);
    const cov = headCoverage(r);
    console.log(`${name}: 头覆盖 ${cov}%`);
  } catch (e) { console.log(`${name}: ERR ${e.message}`); }
}
