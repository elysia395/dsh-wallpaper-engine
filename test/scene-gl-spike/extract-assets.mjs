// Phase 0 spike — 资产提取：scene.pkg → assets/（纹理 PNG + shader 原文 + scene-data.mjs）
// 用法: node test/scene-gl-spike/extract-assets.mjs [pkgPath]
// 不改动任何现有代码；仅用 pkg-extract 已导出的 parsePkg/readPkgEntry/decodeTex
// 与 scene-renderer 已导出的 encodePng。
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { parsePkg, readPkgEntry, decodeTex } from '../../lib/pkg-extract.js';
import { encodePng } from '../../lib/scene-renderer.js';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PKG = process.argv[2] || '/home/beef/Pictures/WallpaperEngine/3295448069/scene.pkg';
const OUT = path.join(HERE, 'assets');
fs.mkdirSync(OUT, { recursive: true });

const buf = fs.readFileSync(PKG);
const entries = parsePkg(buf);
const byPath = new Map(entries.map((e) => [e.path, e]));
const readEntry = (p) => {
  const e = byPath.get(p);
  if (!e) throw new Error('pkg 缺条目: ' + p);
  return readPkgEntry(buf, e);
};

// ---- 1. 文本类资产原样落盘 ----
const textPaths = [
  'scene.json',
  'effects/waterripple/effect.json',
  'effects/iris/effect.json',
  'materials/207电脑.json',
  'materials/effects/waterripple.json',
  'materials/effects/iris.json',
  'shaders/effects/waterripple.vert',
  'shaders/effects/waterripple.frag',
  'shaders/effects/iris.vert',
  'shaders/effects/iris.frag',
];
for (const p of textPaths) {
  const dst = path.join(OUT, p.replace(/\//g, '__'));
  fs.writeFileSync(dst, readEntry(p));
  console.log('text  ', p);
}

// ---- 2. 纹理解码 → PNG（浏览器 <img>/createImageBitmap 可直接吃）----
// kind: jpeg/png-pass → 字节透传；rgba → encodePng
const texPaths = [
  'materials/207电脑.tex',
  'materials/masks/waterripple_mask_206a0206.tex',
  'materials/masks/iris_mask_d44b353d.tex',
  'materials/effects/waterripplenormal.tex',
];
const texMeta = {};
for (const p of texPaths) {
  const decoded = decodeTex(readEntry(p));
  const short = p.replace(/^materials\//, '').replace(/\.tex$/, '').replace(/\//g, '__')
    .replace(/[^\x20-\x7e]/g, '_'); // 中文文件名 → _（避免 URL 编码坑）
  let file;
  if (decoded.kind === 'jpeg') { file = short + '.jpg'; fs.writeFileSync(path.join(OUT, file), decoded.bytes); }
  else if (decoded.kind === 'png-pass') { file = short + '.png'; fs.writeFileSync(path.join(OUT, file), decoded.bytes); }
  else { file = short + '.png'; fs.writeFileSync(path.join(OUT, file), encodePng(decoded.width, decoded.height, decoded.rgba)); }
  texMeta[p] = { file, w: decoded.width, h: decoded.height, kind: decoded.kind };
  console.log('tex   ', p, '→', file, decoded.width + 'x' + decoded.height, decoded.kind);
}

// ---- 3. scene-data.mjs：spike 页硬编码数据源（JSON 内嵌，零解析逻辑）----
const J = (p) => JSON.parse(readEntry(p).toString('utf8'));
const sceneData = {
  pkg: PKG,
  scene: J('scene.json'),
  effects: {
    waterripple: J('effects/waterripple/effect.json'),
    iris: J('effects/iris/effect.json'),
  },
  materials: {
    main: J('materials/207电脑.json'),
    waterripple: J('materials/effects/waterripple.json'),
    iris: J('materials/effects/iris.json'),
  },
  textures: texMeta,
};
const banner = '// 自动生成 (extract-assets.mjs) — 请勿手改\n';
fs.writeFileSync(
  path.join(HERE, 'scene-data.mjs'),
  banner + 'export const SCENE_DATA = ' + JSON.stringify(sceneData, null, 2) + ';\n'
);
console.log('scene-data.mjs written');
