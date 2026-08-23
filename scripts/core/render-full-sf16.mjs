// 渲染全尺寸 (3840x2160) 修复后帧 — 与 DSH 实机渲染一致
import fs from 'node:fs';
import path from 'node:path';
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const targets = [
  ['3486806915', 'amiya'],
  ['3629379075', 'ruoye'],
  ['3641860575', 'tianshi'],
  ['3655429099', 'luotianyi'],
];
for (const [id, name] of targets) {
  const t0 = Date.now();
  try {
    const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
    r.render();
    const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
    const fp = path.join('scripts/out', `${name}_full_sf16.png`);
    fs.writeFileSync(fp, png);
    console.log(`${name}: ${r.W}x${r.H} ${Date.now() - t0}ms → ${fp}`);
  } catch (e) {
    console.log(`${name} ERR: ${e.message}`);
  }
}
