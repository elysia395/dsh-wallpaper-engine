// 五官 cropoffset 测试: 右眼(有crop) 左眼(无crop) 眉毛 鼻子
// 变体: 无crop / 仅crop五官(y原样) / 仅crop五官(y取反)
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import { SceneRenderer, encodePng, getVal, Canvas } from '../lib/scene-renderer.js';
import fs from 'fs';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/';
const r = new SceneRenderer(PKG, { width: 3840, height: 2160, time: 0, log: () => {} });

// 五官部件: 头697, 右眼295, 左眼329, 眉毛373, 鼻子701
const FACE = [697, 295, 329, 373, 701];

function renderFace(cropMode) {
  const canvas = new Canvas(3840, 2160);
  for (const id of FACE) {
    const o = r.objects.find(x => x.id === id);
    const model = r.pkg.readJson(o.image);
    const tr = r.resolveTransform(o);
    const alpha = getVal(o, 'alpha', 1);
    const cropRaw = (model.cropoffset || '0 0').trim().split(/\s+/).map(Number);
    const mesh = r._parseMdl(r.pkg.read(model.puppet));
    const tex = r.loadModelTexture(o.image);
    if (!tex) continue;
    let cx = 0, cy = 0;
    if (cropMode !== 'none') {
      cx = cropRaw[0] || 0;
      cy = cropMode === 'yflip' ? -(cropRaw[1] || 0) : (cropRaw[1] || 0);
    }
    const verts = mesh.positions.map(p => [p[0] + cx, p[1] + cy, p[2]]);
    const b = r._meshBounds(verts);
    const W = Math.ceil(b.maxX - b.minX) + 1, H = Math.ceil(b.maxY - b.minY) + 1;
    const flipY = (y) => b.maxY - y;
    const img = r._rasterizeMesh(mesh, tex, verts, b, W, H, flipY);
    const dx = tr.origin[0] + b.minX, dy = (r.H - tr.origin[1]) - b.maxY;
    canvas.blitScaled(img, dx, dy, W, H, alpha);
  }
  return canvas;
}

const modes = [
  { id: 'F1', desc: '五官全无crop', mode: 'none' },
  { id: 'F2', desc: '五官crop y原样', mode: 'yasis' },
  { id: 'F3', desc: '五官crop y取反', mode: 'yflip' },
];

for (const v of modes) {
  const canvas = renderFace(v.mode);
  const buf = await sharp(Buffer.from(encodePng(canvas.w, canvas.h, canvas.data)))
    .extract({ left: 550, top: 900, width: 700, height: 900 })
    .resize(700, 900).png().toBuffer();
  fs.writeFileSync(OUT + 'face_' + v.id + '_' + v.desc + '.png', buf);
  console.log('生成 face_' + v.id, v.desc);
}
console.log('完成');
