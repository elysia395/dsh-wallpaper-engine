// 生成无cropoffset与有cropoffset两个版本的完整渲染 (含背景), 供 vision 对比
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import { SceneRenderer, encodePng, getVal, Canvas } from '../lib/scene-renderer.js';
import fs from 'fs';

function renderFull(cropMode) {
  const r = new SceneRenderer('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg', { width: 3840, height: 2160, time: 0, log: () => {} });
  const canvas = new Canvas(3840, 2160);
  for (const o of r.renderOrder) {
    if (o._renderType !== 'image') continue;
    const model = r.pkg.readJson(o.image);
    if (!model) continue;
    const tr = r.resolveTransform(o);
    const alpha = getVal(o, 'alpha', 1);
    if (model.puppet) {
      const crop = cropMode === 'crop' ? (model.cropoffset || '0 0').trim().split(/\s+/).map(Number) : [0, 0];
      const mesh = r._parseMdl(r.pkg.read(model.puppet));
      const tex = r.loadModelTexture(o.image);
      if (!tex) continue;
      const verts = mesh.positions.map(p => [p[0] + (crop[0] || 0), p[1] - (crop[1] || 0), p[2]]);
      const b = r._meshBounds(verts);
      const W = Math.ceil(b.maxX - b.minX) + 1, H = Math.ceil(b.maxY - b.minY) + 1;
      const flipY = (y) => b.maxY - y;
      const img = r._rasterizeMesh(mesh, tex, verts, b, W, H, flipY);
      const dx = tr.origin[0] + b.minX, dy = (r.H - tr.origin[1]) - b.maxY;
      canvas.blitScaled(img, dx, dy, W, H, alpha);
    } else {
      const tex = r.loadModelTexture(o.image);
      if (!tex) continue;
      let size = [0, 0];
      if (o.size) { const p = String(o.size).trim().split(/\s+/).map(Number); size = [p[0]||0, p[1]||0]; }
      if (!size[0] || !size[1]) size = [tex.width, tex.height];
      if (model.fullscreen) size = [3840, 2160];
      const dw = size[0] * tr.scale[0], dh = size[1] * tr.scale[1];
      const dx = tr.origin[0] - dw / 2, dy = (r.H - tr.origin[1]) - dh / 2;
      canvas.blitScaled(tex, dx, dy, dw, dh, alpha);
    }
  }
  return canvas;
}

const cNoCrop = renderFull('nocrop');
const cCrop = renderFull('crop');
// 缩放一半便于 vision 分析 (3840x2160 太大)
const bufNo = await sharp(Buffer.from(encodePng(cNoCrop.w, cNoCrop.h, cNoCrop.data))).resize(1920, 1080).png().toBuffer();
const bufCrop = await sharp(Buffer.from(encodePng(cCrop.w, cCrop.h, cCrop.data))).resize(1920, 1080).png().toBuffer();
fs.writeFileSync('D:/dsh-wallpaper-engine/scene-layers-out/amiya_nocrop_full.png', bufNo);
fs.writeFileSync('D:/dsh-wallpaper-engine/scene-layers-out/amiya_crop_full.png', bufCrop);
console.log('已生成两版完整渲染 (1920x1080)');
