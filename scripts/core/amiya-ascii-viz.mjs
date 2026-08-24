// Amiya 头区域 ASCII 可视化 (每 5px 一格主色)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';

function renderMode(mode) {
  const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
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
  } else if (mode === 'no-coat') {
    for (const o of r.objects) if ([403, 449, 407].includes(o.id)) o.visible = false;
  }
  r.render();
  return r;
}

// 色块分类: 肤色/发色/大衣色/背景
function classify(r, x, y) {
  const i = (y * r.W + x) * 4;
  const R = r.canvas.data[i], G = r.canvas.data[i+1], B = r.canvas.data[i+2], A = r.canvas.data[i+3];
  if (A < 10) return '.';
  // 暗色 (大衣/阴影)
  if (R < 80 && G < 80 && B < 90) return 'D';
  // 肤色 (粉/橙)
  if (R > 150 && G > 100 && G < 200 && B > 70 && B < 180 && R > G) return 'S';
  // 发色 (棕/黑/紫)
  if (R < 130 && G < 110 && B < 150 && (R > 50 || G > 40)) return 'H';
  // 白/亮
  if (R > 200 && G > 200 && B > 200) return 'W';
  // 蓝/紫 (衣)
  if (B > 150 && B > R) return 'C';
  return '?';
}

for (const mode of ['array', 'no-coat', 'deep-first']) {
  const r = renderMode(mode);
  console.log(`=== ${mode} (y150-450, x100-350) ===`);
  for (let y = 150; y < 450; y += 5) {
    let line = '';
    for (let x = 100; x < 350; x += 5) line += classify(r, x, y);
    console.log(line);
  }
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_ascii_${mode}.png`, png);
}
