// 验证 host scene-frame 集成: 渲染器路径 + 缓存 + 回退
import { SceneRenderer, encodePng } from '../lib/scene-renderer.js';
import fs from 'fs';
import path from 'path';

const PKG = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';
const cacheDir = 'D:/dsh-wallpaper-engine/scene-layers-out/cache_test';

// 模拟 host 逻辑 (lib/index.js 的 scene-frame 路由核心)
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
      console.log('完整场景渲染成功');
    } catch (e) {
      console.log('渲染失败回退:', e.message);
    }
    if (!rendered) {
      console.log('回退旧提取 (此处跳过)');
    }
  } else {
    console.log('命中缓存:', pngPath);
  }
  return servePath;
}

// 第一次调用 (渲染)
const t0 = Date.now();
const p1 = await sceneFrame(PKG);
console.log('第一次 (渲染):', Date.now() - t0, 'ms →', p1);

// 第二次调用 (缓存)
const t1 = Date.now();
const p2 = await sceneFrame(PKG);
console.log('第二次 (缓存):', Date.now() - t1, 'ms →', p2);

// 验证 PNG 有效
const buf = fs.readFileSync(p2);
console.log('PNG 签名:', buf.slice(0, 4).toString('hex'), '尺寸:', buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20), '大小:', buf.length, 'B');

// 清理
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log('缓存测试目录已清理');
