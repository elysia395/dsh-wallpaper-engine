// 完整回归: sf21 渲染 Amiya + 各对象位置汇总
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: (m) => console.log('LOG:', m) });
r.render();
const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
fs.writeFileSync('scripts/out/amiya_sf21_1080.png', png);
console.log('完整渲染完成, 尺寸:', r.canvas.width, 'x', r.canvas.height);
// 全帧非零像素比例 (确认画面正常)
const d = r.canvas.data;
let nz = 0, total = r.W * r.H;
for (let i = 3; i < d.length; i += 4) if (d[i] > 10) nz++;
console.log(`非透明像素: ${nz}/${total} (${(nz/total*100).toFixed(1)}%)`);
