// 批量渲染所有 workshop 场景壁纸, 统计结果
import fs from 'node:fs';
import path from 'node:path';
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodePng } from '../../lib/we-renderer/canvas.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const outDir = 'scripts/out/ws-batch';
fs.mkdirSync(outDir, { recursive: true });

const ids = fs.readdirSync(WS).filter((d) => fs.existsSync(path.join(WS, d, 'scene.pkg')));
const results = [];
for (const id of ids) {
  const t0 = Date.now();
  try {
    const r = new SceneRenderer(path.join(WS, id, 'scene.pkg'), {
      width: 480, height: 270, time: 0, weAssetsDir: WE, log: () => {},
    });
    r.render();
    const d = r.canvas.data;
    let sum = [0, 0, 0], nz = 0, n = r.canvas.w * r.canvas.h;
    for (let i = 0; i < d.length; i += 4) {
      sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2];
      if (d[i] || d[i + 1] || d[i + 2]) nz++;
    }
    const avg = sum.map((v) => Math.round(v / n));
    fs.writeFileSync(path.join(outDir, id + '.png'), encodePng(r.canvas.w, r.canvas.h, d));
    results.push({ id, ok: true, ms: Date.now() - t0, avg, nz: (nz / n * 100).toFixed(1), objs: r.objects.length });
    console.log(id + ': OK ' + Date.now() + 'ms 对象' + r.objects.length + ' 均值' + avg.join(',') + ' 非黑' + (nz / n * 100).toFixed(1) + '%');
  } catch (e) {
    results.push({ id, ok: false, err: e.message });
    console.log(id + ': FAIL ' + e.message);
  }
}
console.log('\n==== 汇总 ====');
console.log('成功 ' + results.filter(r => r.ok).length + '/' + results.length);
fs.writeFileSync('scripts/out/ws-batch/results.json', JSON.stringify(results, null, 1));
