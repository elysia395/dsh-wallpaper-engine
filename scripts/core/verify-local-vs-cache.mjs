// 验证: 本地新代码渲染 Amiya vs sf14 缓存帧 (代码是否生效)
import fs from 'node:fs';
import { decodePngBuffer } from '../../lib/we-renderer/canvas.js';
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';

// sf14 Amiya 缓存
const dir = process.env.USERPROFILE + '/.dsh-wallpaper-engine/cache/frames';
const files = fs.readdirSync(dir);
const sf14 = files.find((f) => {
  const m = f.match(/^sf14_([^_]+)/);
  if (!m) return false;
  const dec = Buffer.from(m[1], 'base64url').toString('utf8');
  return dec.includes('3486806915');
});
if (!sf14) { console.log('无 sf14 Amiya'); process.exit(0); }
const cacheImg = decodePngBuffer(fs.readFileSync(dir + '/' + sf14));
console.log('sf14 缓存: ' + cacheImg.width + 'x' + cacheImg.height);

// 本地渲染 (同尺寸)
const r = new SceneRenderer(WS + '/3486806915/scene.pkg', { width: cacheImg.width, height: cacheImg.height, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
const mine = r.canvas.data;

// 对比
let diff = 0, maxD = 0;
for (let i = 0; i < mine.length; i += 4) {
  const d = Math.abs(cacheImg.rgba[i] - mine[i]) + Math.abs(cacheImg.rgba[i + 1] - mine[i + 1]) + Math.abs(cacheImg.rgba[i + 2] - mine[i + 2]);
  if (d > 30) diff++;
  if (d > maxD) maxD = d;
}
console.log('本地渲染 vs sf14 缓存: 差异=' + diff + ' max=' + maxD + (diff === 0 ? ' ← 完全一致 (worker=本地代码)' : ' ← 不同!'));
