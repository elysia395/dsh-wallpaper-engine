// 渲染修复后的问题壁纸帧 (960x540) 用于验证 alignment 修复
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
  ['3554161528', 'hina'],
  ['3655429099', 'luotianyi'],
];
const outDir = 'scripts/out';
fs.mkdirSync(outDir, { recursive: true });
for (const [id, name] of targets) {
  try {
    const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
    const t0 = Date.now();
    r.render();
    const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
    const fp = path.join(outDir, `${name}_sf16.png`);
    fs.writeFileSync(fp, png);
    // 非背景像素统计
    const d = r.canvas.data;
    let nz = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) nz++;
    console.log(`${name} (${id}): ${r.W}x${r.H} 非透明像素 ${nz} (${((nz / (r.W * r.H)) * 100).toFixed(1)}%) ${Date.now() - t0}ms → ${fp}`);
  } catch (e) {
    console.log(`${name} (${id}) ERR: ${e.message}`);
  }
}
