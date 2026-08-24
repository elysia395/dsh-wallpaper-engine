// 娴嬭瘯: image 灞?澶ц。/韬共)涓嶇敤 cropoffset, puppet 灞?澶?鐪?鐢?cropoffset
// 鐢熸垚瀹屾暣浜虹墿娓叉煋
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import { SceneRenderer, encodePng, getVal, Canvas } from '../../lib/scene-renderer.js';
import fs from 'fs';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/';

function render(cropPuppet, cropImage) {
  const r = new SceneRenderer(PKG, { width: 3840, height: 2160, time: 0, log: () => {} });
  const canvas = new Canvas(3840, 2160);
  for (const o of r.renderOrder) {
    if (o._renderType !== 'image') continue;
    const model = r.pkg.readJson(o.image);
    if (!model) continue;
    const tr = r.resolveTransform(o);
    const alpha = getVal(o, 'alpha', 1);
    if (model.puppet) {
      const crop = cropPuppet ? (model.cropoffset || '0 0').trim().split(/\s+/).map(Number) : [0, 0];
      const mesh = r._parseMdl(r.pkg.read(model.puppet));
      const tex = r.loadModelTexture(o.image);
      if (!tex) continue;
      const verts = mesh.positions.map(p => [p[0] + (crop[0]||0), p[1] + (crop[1]||0), p[2]]);
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
      const dw = size[0], dh = size[1];
      // image 灞? cropoffset 鏄惁搴旂敤?
      let ox = 0, oy = 0;
      if (cropImage && model.cropoffset) {
        const c = model.cropoffset.trim().split(/\s+/).map(Number);
        ox = c[0]||0; oy = c[1]||0;
      }
      const dx = tr.origin[0] + ox - dw / 2, dy = (r.H - (tr.origin[1] + oy)) - dh / 2;
      canvas.blitScaled(tex, dx, dy, dw, dh, alpha);
    }
  }
  return canvas;
}

// 缁勫悎娴嬭瘯
const combos = [
  { id: 'H1', cropPuppet: false, cropImage: false, desc: '鍏ㄩ儴鏃燾rop' },
  { id: 'H2', cropPuppet: true, cropImage: false, desc: '浠卲uppet鐢╟rop' },
  { id: 'H3', cropPuppet: false, cropImage: true, desc: '浠卛mage鐢╟rop' },
  { id: 'H4', cropPuppet: true, cropImage: true, desc: '鍏ㄩ儴鐢╟rop' },
];

for (const c of combos) {
  const canvas = render(c.cropPuppet, c.cropImage);
  const buf = await sharp(Buffer.from(encodePng(canvas.w, canvas.h, canvas.data))).resize(1600, 900).png().toBuffer();
  fs.writeFileSync(OUT + 'combo_' + c.id + '_' + c.desc + '.png', buf);
  console.log('鐢熸垚 combo_' + c.id, c.desc);
}
console.log('瀹屾垚');
