// 追踪 Amiya 父对象链
import fs from 'node:fs';
import path from 'node:path';
import { readPkg } from '../../lib/we-renderer/textures.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const pkg = readPkg(WS + '/3486806915/scene.pkg');
const sj = pkg.readJson('scene.json');

const fmt = (v) => {
  if (v == null) return '-';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.value !== undefined) return String(v.value);
  return JSON.stringify(v);
};

const trace = (id, depth = 0) => {
  const o = sj.objects.find((x) => x.id === id);
  if (!o || depth > 6) return;
  console.log('  '.repeat(depth) + 'id' + id + ' (' + (o.name || '?') + '): origin=' + fmt(o.origin) + ' scale=' + fmt(o.scale).slice(0, 40) + ' angles=' + fmt(o.angles) + ' parent=' + (o.parent ?? '-') + ' type=' + (o.image ? 'image' : o.particle ? 'particle' : o.sound ? 'sound' : o.text ? 'text' : '?'));
  if (o.parent != null) trace(o.parent, depth + 1);
};
for (const id of [467, 494, 463, 528, 464, 484, 500]) {
  console.log('=== 追踪 id' + id + ' ===');
  trace(id);
}
