// scene-anim 路由逻辑验证: 模拟 mediaMap + 路由 handler 的核心路径
// (不启动完整 DSH, 验证 worker 多帧 + APNG 链路)
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(__dirname, '../../lib');

const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const src = WE + '/projects/defaultprojects/shimmering_particles';
const weAssetsDir = WE;

// 模拟 scene-anim 路由逻辑
async function simulateSceneAnim() {
  // 1. 探测相机路径周期 + 粒子 starttime
  const { SceneRenderer } = await import(pathToFileURL(path.join(LIB, 'scene-renderer.js')).href);
  const r = new SceneRenderer(src, { width: 480, height: 270, time: 0, weAssetsDir, log: () => {} });
  let period = 0, starttime = 0;
  const cam = r.scene.camera || {};
  const paths = Array.isArray(cam.paths) ? cam.paths : [];
  for (const p of paths) {
    if (typeof p === 'string') {
      try { const j = r.pkg.readJson(p); if (j && Array.isArray(j.paths)) for (const pp of j.paths) period += (pp.duration || 0); } catch {}
    } else if (p && Array.isArray(p.transforms)) {
      period += (p.duration || 0);
    }
  }
  for (const o of r.objects || []) {
    if (o.particle && typeof o.particle === 'string') {
      try { const pd = r.pkg.readJson(o.particle); if (pd && pd.starttime) starttime = Math.max(starttime, pd.starttime); } catch {}
    }
  }
  console.log('相机路径周期:', period, '粒子 starttime:', starttime);
  const t0 = starttime > 0 ? starttime : 0;
  const loop = Math.max(period, 0.5);
  const fps = 12, sec = 1;
  const frameCount = Math.max(2, Math.round(fps * sec));
  const times = [];
  for (let i = 0; i < frameCount; i++) times.push(t0 + (i / frameCount) * loop);
  console.log('采样时间 (starttime 偏移后):', times.slice(0, 4).map(t => t.toFixed(1)) + '...');
  // 2. worker 多帧渲染
  const workerPath = path.join(LIB, 'scene-render-worker.mjs');
  const w = new Worker(workerPath, {
    workerData: { src, width: 480, height: 270, times, frameDelayMs: Math.round(1000 / fps), weAssetsDir },
    type: 'module',
  });
  const apng = await new Promise((resolve, reject) => {
    w.on('message', (m) => m.ok ? resolve(Buffer.from(m.apng)) : reject(new Error(m.error)));
    w.on('error', reject);
  });
  fs.writeFileSync('D:/dsh-wallpaper-engine/scene-layers-out/route_anim.apng', apng);
  console.log('scene-anim 模拟 APNG:', apng.length, '字节');
  console.log('✓ scene-anim 链路工作 (周期探测 + worker 多帧 + APNG)');
}

simulateSceneAnim().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
