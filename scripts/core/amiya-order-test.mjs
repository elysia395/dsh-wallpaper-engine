// Amiya 渲染顺序实验: 数组顺序 vs 深度排序, 检查头覆盖
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function renderWithOrder(mode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  // 重新计算 renderOrder
  const depth = (o) => {
    let d = 0, cur = o, guard = 0;
    while (cur.parent != null && guard < 20) {
      const p = r.objects.find(x => x.id === cur.parent);
      if (!p) break;
      cur = p; d++; guard++;
    }
    return d;
  };
  let order = [...r.objects];
  if (mode === 'depth-deep-first') {
    // 深度大先渲染 (后景): 背景深度0最后
    order.sort((a, b) => depth(b) - depth(a));
  } else if (mode === 'depth-shallow-first') {
    order.sort((a, b) => depth(a) - depth(b));
  } else if (mode === 'reverse') {
    order.reverse();
  }
  r.renderOrder = order.filter(o => o._renderType === 'image' || o._renderType === 'model' || o._renderType === 'particle' || o._renderType === 'text');
  r.render();
  return r;
}

// 头内容区域 (单组件测得): 158,266..267,412
function headCoverage(r, mode) {
  // 用跳过躯干/大衣 (449/407/403) 的对比
  const r2 = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  const depth = (o) => {
    let d = 0, cur = o, guard = 0;
    while (cur.parent != null && guard < 20) {
      const p = r2.objects.find(x => x.id === cur.parent);
      if (!p) break;
      cur = p; d++; guard++;
    }
    return d;
  };
  let order = [...r2.objects];
  if (mode === 'depth-deep-first') order.sort((a, b) => depth(b) - depth(a));
  else if (mode === 'depth-shallow-first') order.sort((a, b) => depth(a) - depth(b));
  else if (mode === 'reverse') order.reverse();
  r2.renderOrder = order.filter(o => o._renderType === 'image' || o._renderType === 'model' || o._renderType === 'particle' || o._renderType === 'text');
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

for (const mode of ['array', 'depth-shallow-first', 'depth-deep-first', 'reverse']) {
  try {
    const r = renderWithOrder(mode);
    const cov = headCoverage(r);
    console.log(`${mode}: 头覆盖 ${cov}%`);
  } catch (e) {
    console.log(`${mode}: ERR ${e.message}`);
  }
}
