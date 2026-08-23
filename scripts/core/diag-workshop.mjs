// 诊断: 渲染所有 workshop 场景, 收集跳过/失败日志
import fs from 'node:fs';
import path from 'node:path';
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';

const ids = fs.readdirSync(WS).filter((d) => fs.existsSync(path.join(WS, d, 'scene.pkg')));
const diag = {};
for (const id of ids) {
  const logs = [];
  try {
    const r = new SceneRenderer(path.join(WS, id, 'scene.pkg'), {
      width: 400, height: 225, time: 5, weAssetsDir: WE, log: (m) => logs.push(m),
    });
    r.render();
  } catch (e) {
    logs.push('FATAL: ' + e.message);
  }
  diag[id] = logs;
  if (logs.length) {
    console.log('=== ' + id + ' (' + logs.length + ' 条日志) ===');
    logs.slice(0, 12).forEach((m) => console.log('  ' + m));
  }
}
fs.writeFileSync('scripts/out/ws-batch/diag.json', JSON.stringify(diag, null, 1));
console.log('\n诊断完成, 已保存 diag.json');
