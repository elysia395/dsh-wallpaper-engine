// deep-first 渲染: 检查头面发耳组件内容是否可见 (不被大衣盖)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(mode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (mode === 'deep-first') {
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
    const order = [...r.objects].sort((a, b) => (depth(b) - depth(a)) || (arrIdx.get(a.id) - arrIdx.get(b.id)));
    r.renderOrder = order.filter(o => ['image', 'model', 'particle', 'text'].includes(o._renderType));
  }
  r.render();
  return r;
}

// 组件内容区域 (单组件渲染测得的 bbox)
const comps = {
  697: [158, 266, 267, 412],   // 头
  295: [222, 334, 238, 350],   // 右眼
  329: [181, 320, 209, 337],   // 左眼
  701: [213, 331, 228, 350],   // 鼻子
  459: [111, 263, 217, 390],   // 主发
  421: [218, 241, 326, 288],   // 右耳
  685: [180, 176, 259, 274],   // 左耳
};
for (const mode of ['array', 'deep-first']) {
  const r = make(mode);
  const d = r.canvas.data;
  console.log(`=== ${mode} ===`);
  for (const [oid, [x0, y0, x1, y1]] of Object.entries(comps)) {
    // 该区域的内容像素 (alpha>0) — 无论哪个组件画的
    let nz = 0, total = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * r.W + x) * 4;
      total++;
      if (d[i + 3] > 10) nz++;
    }
    console.log(`  ${oid} (${x0},${y0}..${x1},${y1}): 内容 ${nz}/${total} (${((nz / total) * 100).toFixed(0)}%)`);
  }
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_${mode}_960.png`, png);
}
console.log('帧已保存');
