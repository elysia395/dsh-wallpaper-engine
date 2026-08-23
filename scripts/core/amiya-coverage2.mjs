// Amiya 头内容区域覆盖检测: 全量 vs 跳过右大衣/身体, 对比头实际内容区域
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';
const T = 2.5;

function renderFrame() {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: T, weAssetsDir: WE, log: () => {} });
  r.render();
  return r;
}

// 全量
const A = renderFrame();
// 跳过 449(右大衣) 407(身体) 403(左大衣)
const B = renderFrame();
for (const o of B.objects) if ([449, 407, 403].includes(o.id)) o.visible = false;
B.render();

const dA = A.canvas.data, dB = B.canvas.data;
const W = A.W, H = A.H;

// 头内容 bbox (从单独渲染得知): 151,362..261,506
const hx = 151, hy = 362, hx2 = 261, hy2 = 506;
let covered = 0, total = 0, covByY = new Map();
for (let y = hy; y <= hy2; y++) {
  for (let x = hx; x <= hx2; x++) {
    const i = (y * W + x) * 4;
    const aA = dA[i + 3], aB = dB[i + 3];
    const diff = Math.abs(dA[i] - dB[i]) + Math.abs(dA[i+1] - dB[i+1]) + Math.abs(dA[i+2] - dB[i+2]);
    if (aA > 0 && (aB === 0 || diff > 60)) {
      covered++;
      const yk = Math.floor(y / 10) * 10;
      covByY.set(yk, (covByY.get(yk) || 0) + 1);
    }
    total++;
  }
}
console.log(`头内容区域 (${hx},${hy}..${hx2},${hy2}) 总${total} 被大衣/身体覆盖 ${covered} (${((covered / total) * 100).toFixed(1)}%)`);
for (const [yk, c] of [...covByY.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  y=${yk}-${yk + 10}: 覆盖 ${c}`);
}
