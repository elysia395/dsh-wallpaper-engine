// worker 路径测试: 模拟 index.js renderSceneFrameInWorker
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';

const src = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\projects\\defaultprojects\\dino_run';
const weAssetsDir = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine';

const worker = new Worker(new URL('../lib/scene-render-worker.mjs', import.meta.url), {
  workerData: { src, width: 1920, height: 1080, time: 2.5, weAssetsDir },
  type: 'module',
});
worker.on('message', (m) => {
  if (m.ok) {
    fs.writeFileSync('D:\\dsh-wallpaper-engine\\scene-layers-out\\effects\\dino_run_worker.png', Buffer.from(m.png));
    console.log(`worker OK: ${m.png.length} bytes, diff=${m.diff}/${m.checked}`);
  } else {
    console.log('worker FAIL:', m.error);
  }
  worker.terminate();
});
worker.on('error', (e) => { console.log('worker error:', e.message); });
