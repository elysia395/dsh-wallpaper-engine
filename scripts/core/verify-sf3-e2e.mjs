// 绔埌绔獙璇? 妯℃嫙 host scene-frame 璺敱 (sf3_ key + 娓叉煋鍣?+ 鐪熷疄缂撳瓨鐩綍)
import { SceneRenderer, encodePng } from '../../lib/scene-renderer.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';

const PKG = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';

// 妯℃嫙 lib/index.js 鐨?scene-frame 閫昏緫 (sf3_ 鍓嶇紑)
function tokenFor(absPath) {
  return Buffer.from(absPath, 'utf8').toString('base64url');
}

async function sceneFrame(abs, cacheDir) {
  let mtime = 0;
  try { mtime = fs.statSync(abs).mtimeMs; } catch {}
  const key = 'sf3_' + tokenFor(abs) + '_' + Math.round(mtime);
  fs.mkdirSync(cacheDir, { recursive: true });
  const pngPath = path.join(cacheDir, key + '.png');
  let servePath = fs.existsSync(pngPath) ? pngPath : null;
  let usedRenderer = false;
  if (!servePath) {
    try {
      const renderer = new SceneRenderer(abs, { width: 3840, height: 2160, time: 0, log: () => {} });
      const canvas = renderer.render();
      fs.writeFileSync(pngPath, encodePng(canvas.w, canvas.h, canvas.data));
      servePath = pngPath;
      usedRenderer = true;
    } catch (e) {
      console.log('娓叉煋澶辫触:', e.message);
    }
  }
  return { servePath, usedRenderer, key };
}

// 涓存椂缂撳瓨鐩綍
const cacheDir = path.join(os.tmpdir(), 'we-verify-' + Date.now());
const t0 = Date.now();
const r1 = await sceneFrame(PKG, cacheDir);
console.log('绗竴娆?', r1.usedRenderer ? '鉁?娓叉煋鍣? : '鉁?鍥為€€', (Date.now() - t0) + 'ms');
console.log('缂撳瓨鏂囦欢:', r1.key + '.png');
// 楠岃瘉杈撳嚭鏄畬鏁村満鏅?(闈炰富绾圭悊): 妫€鏌ュ昂瀵?
const buf = fs.readFileSync(r1.servePath);
console.log('甯у昂瀵?', buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20), '澶у皬:', buf.length, 'B');

// 绗簩娆? 缂撳瓨鍛戒腑
const t1 = Date.now();
const r2 = await sceneFrame(PKG, cacheDir);
console.log('绗簩娆?', r2.usedRenderer ? '閲嶆柊娓叉煋' : '鉁?缂撳瓨鍛戒腑', (Date.now() - t1) + 'ms');

// 纭鏃?sf2 缂撳瓨涓嶄細鍛戒腑 (key 涓嶅悓)
const oldKey = 'sf2_' + tokenFor(PKG) + '_1752076871219'; // 鏃?mtime
console.log('鏃?sf2 key 瀛樺湪:', fs.existsSync(path.join(cacheDir, oldKey + '.png')), '(搴?false, 寮哄埗澶辨晥)');

// 娓呯悊
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log('楠岃瘉瀹屾垚');
