// 扫描所有 workshop .tex 的 TEXV/TEXB/TEXI/TEXS 版本
import fs from 'node:fs';
import path from 'node:path';
import { readPkg } from '../../lib/we-renderer/textures.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const ids = fs.readdirSync(WS).filter((d) => fs.existsSync(path.join(WS, d, 'scene.pkg')));
const versions = {};
let total = 0;
for (const id of ids) {
  let pkg;
  try { pkg = readPkg(path.join(WS, id, 'scene.pkg')); } catch { continue; }
  const texs = pkg.entries().filter((e) => e.name.endsWith('.tex'));
  for (const t of texs) {
    total++;
    const buf = pkg.read(t.name);
    if (!buf || buf.length < 16) continue;
    // 提取所有魔数 (TEXV/TEXI/TEXB/TEXS + 版本)
    const magics = [];
    for (const m of ['TEXV', 'TEXI', 'TEXB', 'TEXS']) {
      let off = buf.indexOf(m);
      if (off >= 0 && off + 8 <= buf.length) {
        const v = buf.toString('ascii', off + 4, off + 8);
        if (/^\d{4}$/.test(v)) magics.push(m + v);
      }
    }
    const key = magics.join('|') || '?';
    versions[key] = (versions[key] || 0) + 1;
  }
}
console.log('总 tex:', total);
for (const [k, v] of Object.entries(versions)) console.log('  ' + k + ': ' + v);
