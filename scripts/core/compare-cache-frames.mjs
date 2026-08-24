// 对比 sf14 (新代码) vs sf13 (旧代码) 相同壁纸的帧内容
import fs from 'node:fs';
import { decodePngBuffer } from '../../lib/we-renderer/canvas.js';

const dir = process.env.USERPROFILE + '/.dsh-wallpaper-engine/cache/frames';
const files = fs.readdirSync(dir);
const byKey = {};
for (const f of files) {
  const m = f.match(/^(sf\d+)_([^_]+)/);
  if (!m) continue;
  const idPart = m[2];
  const dec = Buffer.from(idPart, 'base64url').toString('utf8');
  const id = (dec.match(/431960[\\/](\d+)/) || dec.match(/defaultprojects[\\/](\w+)/) || [])[1];
  if (!id) continue;
  byKey[id] = byKey[id] || {};
  byKey[id][m[1]] = f;
}

for (const [id, keys] of Object.entries(byKey)) {
  if (!keys.sf13 || !keys.sf14) continue;
  const a = decodePngBuffer(fs.readFileSync(dir + '/' + keys.sf13));
  const b = decodePngBuffer(fs.readFileSync(dir + '/' + keys.sf14));
  if (a.width !== b.width || a.height !== b.height) { console.log(id + ': 尺寸不同 ' + a.width + 'x' + a.height + ' vs ' + b.width + 'x' + b.height); continue; }
  let diff = 0, maxD = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    const d = Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
    if (d > 30) diff++;
    if (d > maxD) maxD = d;
  }
  console.log(id + ': sf13 vs sf14 差异像素=' + diff + ' maxDiff=' + maxD + (diff === 0 ? ' ← 相同!' : ''));
}
