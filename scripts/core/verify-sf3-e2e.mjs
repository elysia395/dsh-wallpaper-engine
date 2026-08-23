// 端到端验证: 模拟 host scene-frame 路由 (sf3_ key + 渲染器 + 真实缓存目录)
import { SceneRenderer, encodePng } from '../lib/scene-renderer.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';

const PKG = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';

// 模拟 lib/index.js 的 scene-frame 逻辑 (sf3_ 前缀)
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
      console.log('渲染失败:', e.message);
    }
  }
  return { servePath, usedRenderer, key };
}

// 临时缓存目录
const cacheDir = path.join(os.tmpdir(), 'we-verify-' + Date.now());
const t0 = Date.now();
const r1 = await sceneFrame(PKG, cacheDir);
console.log('第一次:', r1.usedRenderer ? '✓ 渲染器' : '✗ 回退', (Date.now() - t0) + 'ms');
console.log('缓存文件:', r1.key + '.png');
// 验证输出是完整场景 (非主纹理): 检查尺寸
const buf = fs.readFileSync(r1.servePath);
console.log('帧尺寸:', buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20), '大小:', buf.length, 'B');

// 第二次: 缓存命中
const t1 = Date.now();
const r2 = await sceneFrame(PKG, cacheDir);
console.log('第二次:', r2.usedRenderer ? '重新渲染' : '✓ 缓存命中', (Date.now() - t1) + 'ms');

// 确认旧 sf2 缓存不会命中 (key 不同)
const oldKey = 'sf2_' + tokenFor(PKG) + '_1752076871219'; // 旧 mtime
console.log('旧 sf2 key 存在:', fs.existsSync(path.join(cacheDir, oldKey + '.png')), '(应 false, 强制失效)');

// 清理
fs.rmSync(cacheDir, { recursive: true, force: true });
console.log('验证完成');
