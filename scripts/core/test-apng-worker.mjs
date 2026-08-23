// 多帧 APNG worker 测试
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/shimmering_particles';
const weAssetsDir = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const workerPath = path.resolve('lib/scene-render-worker.mjs');
const w = new Worker(workerPath, {
  workerData: { src, width: 480, height: 270, times: [50, 52, 54, 56, 58, 60], frameDelayMs: 100, weAssetsDir },
  type: 'module',
});
w.on('message', (m) => {
  if (m.ok) {
    const apng = Buffer.from(m.apng);
    fs.writeFileSync('D:/dsh-wallpaper-engine/scene-layers-out/shimmer_anim.apng', apng);
    console.log('APNG OK:', apng.length, '字节');
    // 验证块结构
    let off = 8;
    const types = [];
    while (off < apng.length) {
      const len = apng.readUInt32BE(off);
      types.push(apng.toString('ascii', off + 4, off + 8));
      off += 12 + len;
    }
    console.log('块:', types.join(', '));
    console.log('acTL 存在:', types.includes('acTL'), 'fcTL 数:', types.filter(t => t === 'fcTL').length);
  } else {
    console.log('FAIL:', m.error);
  }
  w.terminate();
});
w.on('error', (e) => console.log('error:', e.message));
