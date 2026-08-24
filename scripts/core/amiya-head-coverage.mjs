// Amiya 头内容覆盖测试 (修复 cropoffset+MDLA 后)
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
const dA = r.canvas.data;

// 跳过躯干/大衣的版本
const r2 = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
for (const o of r2.objects) if ([449, 407, 403].includes(o.id)) o.visible = false;
r2.render();
const dB = r2.canvas.data;

// 头内容区域 (单组件测得): 158,266..267,412
const hx = 158, hy = 266, hx2 = 267, hy2 = 412;
let covered = 0, total = 0;
for (let y = hy; y <= hy2; y++) for (let x = hx; x <= hx2; x++) {
  const i = (y * r.W + x) * 4;
  const aA = dA[i + 3], aB = dB[i + 3];
  const diff = Math.abs(dA[i] - dB[i]) + Math.abs(dA[i+1] - dB[i+1]) + Math.abs(dA[i+2] - dB[i+2]);
  if (aA > 0 && (aB === 0 || diff > 60)) covered++;
  total++;
}
console.log(`头内容区域被大衣/身体覆盖: ${covered}/${total} (${((covered / total) * 100).toFixed(1)}%)`);
