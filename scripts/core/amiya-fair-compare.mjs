// 公平对比: 同排序下 完整 vs 跳过躯干 的头区域差异
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(mode, skipCoat) {
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
    r.renderOrder = [...r.objects].sort((a, b) => (depth(b) - depth(a)) || (arrIdx.get(a.id) - arrIdx.get(b.id)))
      .filter(o => ['image', 'model', 'particle', 'text'].includes(o._renderType));
  }
  if (skipCoat) for (const o of r.objects) if ([403, 449, 407].includes(o.id)) o.visible = false;
  r.render();
  return r;
}

for (const mode of ['array', 'deep-first']) {
  const full = make(mode, false);
  const noCoat = make(mode, true);
  const dA = full.canvas.data, dB = noCoat.canvas.data;
  // 头内容区域 (158,266..267,412) 颜色 diff
  let diff = 0, total = 0, diffRows = {};
  for (let y = 266; y <= 412; y++) for (let x = 158; x <= 267; x++) {
    const i = (y * full.W + x) * 4;
    const dd = Math.abs(dA[i]-dB[i]) + Math.abs(dA[i+1]-dB[i+1]) + Math.abs(dA[i+2]-dB[i+2]);
    if (dA[i+3] > 0 && (dB[i+3] === 0 || dd > 60)) {
      diff++;
      const yk = Math.floor(y / 10) * 10;
      diffRows[yk] = (diffRows[yk] || 0) + 1;
    }
    total++;
  }
  console.log(`${mode}: 头区域被躯干/大衣覆盖 ${(diff / total * 100).toFixed(1)}%`);
  for (const [yk, c] of Object.entries(diffRows).sort((a, b) => a[0] - b[0])) {
    console.log(`  y=${yk}: ${c}px`);
  }
  // 保存帧
  const png = encodeApng(full.W, full.H, [{ rgba: full.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_${mode}_fair.png`, png);
}
console.log('帧已保存');
