// 扫描所有 workshop MDL 的段魔数 (MDLV/MDLS/MDLA/MDAT/MDMP/MDLE)
import fs from 'node:fs';
import path from 'node:path';
import { readPkg } from '../../lib/we-renderer/textures.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const ids = fs.readdirSync(WS).filter((d) => fs.existsSync(path.join(WS, d, 'scene.pkg')));

const segHits = { MDLV: 0, MDLS: 0, MDLA: 0, MDAT: 0, MDMP: 0, MDLE: 0 };
const segPerFile = new Map();
for (const id of ids) {
  let pkg;
  try { pkg = readPkg(path.join(WS, id, 'scene.pkg')); } catch { continue; }
  const mdls = pkg.entries().filter((e) => e.name.endsWith('.mdl'));
  for (const m of mdls) {
    const buf = pkg.read(m.name);
    if (!buf) continue;
    const found = [];
    for (const s of ['MDLV', 'MDLS', 'MDLA', 'MDAT', 'MDMP', 'MDLE']) {
      let off = 0;
      while ((off = buf.indexOf(s, off)) >= 0) {
        // 校验后面是版本号 (数字)
        const v = buf.toString('ascii', off + 4, off + 8);
        if (/^\d{4}$/.test(v)) {
          segHits[s]++;
          found.push(s + v);
        }
        off += 4;
      }
    }
    if (found.length) {
      const key = found.join('+');
      segPerFile.set(key, (segPerFile.get(key) || 0) + 1);
    }
  }
}
console.log('段出现统计:', JSON.stringify(segHits));
console.log('\n=== 段组合分布 ===');
for (const [k, v] of segPerFile) console.log('  ' + k + ': ' + v + ' 个文件');
