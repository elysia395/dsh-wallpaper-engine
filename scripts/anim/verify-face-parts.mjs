// 验证眼睛/眉毛/鼻子渲染是否成功 (单独渲染, 检查内容)
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import { SceneRenderer, encodePng, getVal, Canvas } from '../lib/scene-renderer.js';
import fs from 'fs';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/';
const r = new SceneRenderer(PKG, { width: 3840, height: 2160, time: 0, log: (s) => console.log('LOG:', s) });

// 逐个渲染五官部件, 检查是否有内容
for (const id of [697, 295, 329, 373, 701]) {
  const o = r.objects.find(x => x.id === id);
  const model = r.pkg.readJson(o.image);
  const mesh = r._parseMdl(r.pkg.read(model.puppet));
  const tex = r.loadModelTexture(o.image);
  if (!tex) { console.log('#' + id, o.name, '纹理缺失'); continue; }
  const canvas = new Canvas(3840, 2160);
  const b = r._meshBounds(mesh.positions);
  const W = Math.ceil(b.maxX - b.minX) + 1, H = Math.ceil(b.maxY - b.minY) + 1;
  const flipY = (y) => b.maxY - y;
  const img = r._rasterizeMesh(mesh, tex, mesh.positions, b, W, H, flipY);
  const tr = r.resolveTransform(o);
  const dx = tr.origin[0] + b.minX, dy = (r.H - tr.origin[1]) - b.maxY;
  canvas.blitScaled(img, dx, dy, W, H, 1);
  // 统计
  let cnt = 0;
  for (let y = Math.max(0, dy); y < Math.min(2160, dy + H); y++) for (let x = Math.max(0, dx); x < Math.min(3840, dx + W); x++) {
    const i = (y * canvas.w + x) * 4;
    if (canvas.data[i+3] > 30) cnt++;
  }
  console.log('#' + id, o.name.padEnd(6), '渲染区域 x[' + dx.toFixed(0) + ',' + (dx+W).toFixed(0) + '] y[' + dy.toFixed(0) + ',' + (dy+H).toFixed(0) + '] 不透明像素:', cnt, '纹理:', tex.width + 'x' + tex.height);
  // 保存
  if (id === 295 || id === 329) {
    const buf = await sharp(Buffer.from(encodePng(canvas.w, canvas.h, canvas.data)))
      .extract({ left: Math.max(0, Math.floor(dx)), top: Math.max(0, Math.floor(dy)), width: W, height: H })
      .resize(300, null).png().toBuffer();
    fs.writeFileSync(OUT + 'part_' + id + '_' + o.name + '.png', buf);
  }
}
