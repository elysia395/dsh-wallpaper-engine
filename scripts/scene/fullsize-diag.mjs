// 全尺寸 (3840x2160) 分层渲染: 头/头+五官/完整场景 — 修正画布尺寸错误
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

const { SceneRenderer, encodePng } = await import('../lib/scene-renderer.js');
const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';

const r = new SceneRenderer(PKG, { width: 3840, height: 2160, log: () => {} });
// 去 cropoffset (证据: 非场景位移)
const origReadJson = r.pkg.readJson.bind(r.pkg);
r.pkg.readJson = (p) => {
  const j = origReadJson(p);
  if (j && typeof j === 'object' && 'cropoffset' in j) { const c = { ...j }; delete c.cropoffset; return c; }
  return j;
};

const OUT = 'scene-layers-out/part_analysis/fullsize/';
fs.mkdirSync(OUT, { recursive: true });

async function renderLayers(label, ids) {
  r.canvas.clear();
  for (const o of r.renderOrder) {
    if (ids.includes(o.id) && o._renderType === 'image') {
      try { r.renderImage(o, 0); } catch (e) { console.log(`  渲染 ${o.id} 失败: ${e.message}`); }
    }
  }
  const { data } = r.canvas;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
    if (data[(y*r.W+x)*4+3] > 8) {
      count++;
      if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y;
    }
  }
  fs.writeFileSync(OUT + label + '.png', encodePng(r.W, r.H, data));
  const bbox = count ? `x[${minX},${maxX}] y[${minY},${maxY}] (${maxX-minX+1}x${maxY-minY+1}) px=${count}` : '空';
  console.log(`${label}: ${bbox}`);
  return { minX, minY, maxX, maxY };
}

// 头单独
await renderLayers('head_only', [697]);
// 头 + 五官 (左眼329 右眼295 眉373 鼻701)
await renderLayers('head_face', [697, 329, 295, 373, 701]);
// 完整场景 (全部 image 对象, 无 cropoffset)
await renderLayers('full_nocrop', r.renderOrder.filter(o => o._renderType === 'image').map(o => o.id));

// 缩小输出供对比
for (const name of ['head_only', 'head_face', 'full_nocrop']) {
  // 裁剪头部区域 (x600-1200, y900-1800) 放大
  await sharp(OUT + name + '.png').extract({ left: 600, top: 900, width: 800, height: 900 })
    .resize(800, 900, { kernel: 'lanczos3' }).png().toFile(OUT + name + '_headcrop.png');
}
// 完整场景缩到 220 宽
await sharp(OUT + 'full_nocrop.png').resize(220, null, { fit: 'inside' }).png().toFile(OUT + 'full_nocrop_220.png');
// 并排对比: preview vs full_nocrop
const comp = await sharp(OUT + 'full_nocrop.png').resize(220, null, { fit: 'inside' }).png().toBuffer();
const cm = await sharp(comp).metadata();
const top = Math.floor((220 - cm.height) / 2);
await sharp({ create: { width: 440, height: 220, channels: 3, background: { r: 30, g: 30, b: 30 } } })
  .composite([
    { input: 'scene-layers-out/part_analysis/preview_f0.png', left: 0, top: 0 },
    { input: comp, left: 220, top },
  ]).png().toFile(OUT + 'compare_preview_vs_full_nocrop.png');
console.log('compare_preview_vs_full_nocrop.png saved');
