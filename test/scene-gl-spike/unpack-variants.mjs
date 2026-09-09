// Phase 0 spike — 诊断用：pkg 解包为松散目录 + 效果变体目录（symlink 农场）
// 用法: node test/scene-gl-spike/unpack-variants.mjs
// 产出 /tmp/we-spike-scene/{full,nofx,wr,iris}/ —— 每个目录一份 scene.json（变体）+ 其余文件 symlink
import fs from 'node:fs';
import path from 'node:path';
import { parsePkg, readPkgEntry } from '../../lib/pkg-extract.js';

const PKG = '/home/beef/Pictures/WallpaperEngine/3295448069/scene.pkg';
const ROOT = '/tmp/we-spike-scene';
const FULL = path.join(ROOT, 'full');
fs.rmSync(ROOT, { recursive: true, force: true });
const buf = fs.readFileSync(PKG);
const paths = [];
for (const e of parsePkg(buf)) {
  const dst = path.join(FULL, e.path);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, readPkgEntry(buf, e));
  paths.push(e.path);
}
const scene = JSON.parse(fs.readFileSync(path.join(FULL, 'scene.json'), 'utf8'));
for (const [name, keep] of [['nofx', []], ['wr', ['waterripple']], ['iris', ['iris']]]) {
  const dir = path.join(ROOT, name);
  for (const p of paths) {
    const dst = path.join(dir, p);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (p === 'scene.json') continue;
    fs.symlinkSync(path.join(FULL, p), dst);
  }
  const s = JSON.parse(JSON.stringify(scene));
  s.objects[0].effects = s.objects[0].effects.filter((ef) => keep.some((k) => ef.file.includes(k)));
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify(s, null, 2));
  console.log('variant', name, 'effects=' + s.objects[0].effects.length);
}
console.log('unpacked →', ROOT);
