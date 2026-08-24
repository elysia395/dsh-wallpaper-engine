// 楠岃瘉 host scene-frame 闆嗘垚: 娓叉煋鍣ㄨ矾寰?+ 缂撳瓨 + 鍥為€€
import { SceneRenderer, encodePng } from '../../lib/scene-renderer.js';
import fs from 'fs';
import path from 'path';

const PKG = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';
const cacheDir = 'D:/dsh-wallpaper-engine/scene-layers-out/cache_test';

// 妯℃嫙 host 閫昏緫 (lib/index.js 鐨?scene-frame 璺敱鏍稿績)
async function sceneFrame(abs) {
  let mtime = 0;
  try { mtime = fs.statSync(abs).mtimeMs; } catch { /* */ }
  const key = 'sf3_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime);
  fs.mkdirSync(cacheDir, { recursive: true });
  const pngPath = path.join(cacheDir, key + '.png');
  let servePath = fs.existsSync(pngPath) ? pngPath : null;
  if (!servePath) {
    let rendered = false;
    try {
      const renderer = new SceneRenderer(abs, { width: 3840, height: 2160, time: 0, log: () => {} });
      const canvas = renderer.render();
      fs.writeFileSync(pngPath, encodePng(canvas.w, canvas.h, canvas.data));
      servePath = pngPath;
      rendered = true;
      console.log('瀹屾暣鍦烘櫙娓叉煋鎴愬姛');
    } catch (e) {
      console.log('娓叉煋澶辫触鍥為€€:', e.message);
    }
    if (!rendered) {
      console.log('鍥為€€鏃ф彁鍙?(姝ゅ璺宠繃)');
    }
  } else {
    console.log('鍛戒腑缂撳瓨:', pngPath);
  }
  return servePath;
}

// 绗竴娆¤皟鐢?(娓叉煋)
const t0 = Date.now();
const p1 = await sceneFrame(PKG);
console.log('绗竴娆?(娓叉煋):', Date.now() - t0, 'ms 鈫?, p1);

// 绗簩娆¤皟鐢?(缂撳瓨)
const t1 = Date.now();
const p2 = await sceneFrame(PKG);
console.log('绗簩娆?(缂撳瓨):', Date.now() - t1, 'ms 鈫?, p2);

// 楠岃瘉 PNG 鏈夋晥
const buf = fs.readFileSync(p2);
console.log('PNG 绛惧悕:', buf.slice(0, 4).toString('hex'), '灏哄:', buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20), '澶у皬:', buf.length, 'B');

// 娓呯悊
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log('缂撳瓨娴嬭瘯鐩綍宸叉竻鐞?);
