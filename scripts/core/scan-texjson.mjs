// 扫描 .tex-json 元数据 (spritesheet 等)
import fs from 'node:fs';
import path from 'node:path';
import { readPkg } from '../../lib/we-renderer/textures.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const ids = fs.readdirSync(WS).filter((d) => fs.existsSync(path.join(WS, d, 'scene.pkg')));
let total = 0;
const samples = {};
for (const id of ids) {
  let pkg;
  try { pkg = readPkg(path.join(WS, id, 'scene.pkg')); } catch { continue; }
  const jsons = pkg.entries().filter((e) => e.name.endsWith('.tex-json'));
  for (const j of jsons) {
    total++;
    if (total <= 3) {
      const txt = pkg.readText(j.name);
      samples[j.name] = txt ? txt.slice(0, 300) : '';
    }
  }
}
console.log('tex-json 总数:', total);
for (const [k, v] of Object.entries(samples)) {
  console.log('=== ' + k + ' ===');
  console.log(v);
}
