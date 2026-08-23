// 扫描所有壁纸对象的 alignment/anchor/pivot 字段
import fs from 'node:fs';
import path from 'node:path';
import { readPkg } from '../../lib/we-renderer/textures.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const ids = fs.readdirSync(WS).filter((d) => fs.existsSync(path.join(WS, d, 'scene.pkg')));

const stats = {};
for (const id of ids) {
  let pkg;
  try { pkg = readPkg(path.join(WS, id, 'scene.pkg')); } catch { continue; }
  const sj = pkg.readJson('scene.json');
  const objs = sj.objects || [];
  for (const o of objs) {
    for (const k of ['alignment', 'horizontalalign', 'verticalalign', 'blockalign', 'anchor']) {
      const v = o[k];
      if (v != null && v !== '') {
        const key = k + '=' + String(v);
        stats[key] = (stats[key] || 0) + 1;
        if (!stats[key + '_ids']) stats[key + '_ids'] = new Set();
        stats[key + '_ids'].add(id);
      }
    }
  }
}
for (const [k, v] of Object.entries(stats)) {
  if (k.endsWith('_ids')) continue;
  const idsArr = [...stats[k + '_ids']];
  console.log(k + ': ' + v + ' 个对象, 壁纸: ' + idsArr.join(','));
}
