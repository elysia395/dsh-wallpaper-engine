// 针对头模板 #697 单独测试 cropoffset 处理
// 生成: 头模板 无crop / y原样 / y取反, 叠加到眼睛参考位置
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import { SceneRenderer, encodePng, getVal, Canvas } from '../lib/scene-renderer.js';
import fs from 'fs';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/';
const r = new SceneRenderer(PKG, { width: 3840, height: 2160, time: 0, log: () => {} });

// 参考: 眼睛位置 (无 crop, 用户确认对)
// 左眼 y1277-1355, 右眼 y1339-1403 → 眼睛中心 y≈1340
// 头模板网格 450x579, 中心应落在眼睛上方 (脸的上部)

// 渲染指定部件组合
function renderParts(ids, cropMap) {
  const canvas = new Canvas(3840, 2160);
  for (const id of ids) {
    const o = r.objects.find(x => x.id === id);
    if (!o) continue;
    const model = r.pkg.readJson(o.image);
    const tr = r.resolveTransform(o);
    const alpha = getVal(o, 'alpha', 1);
    const useCrop = cropMap[id] || [0, 0];
    if (model.puppet) {
      const mesh = r._parseMdl(r.pkg.read(model.puppet));
      const tex = r.loadModelTexture(o.image);
      if (!tex) continue;
      const verts = mesh.positions.map(p => [p[0] + useCrop[0], p[1] + useCrop[1], p[2]]);
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
      if (o.size) { const sp = String(o.size).trim().split(/\s+/).map(Number); size = [sp[0]||0, sp[1]||0]; }
      if (!size[0] || !size[1]) size = [tex.width, tex.height];
      // image 层 cropoffset: x+ox, y 屏幕取反
      const dx = tr.origin[0] + useCrop[0] - size[0]/2, dy = (r.H - (tr.origin[1] + useCrop[1])) - size[1]/2;
      canvas.blitScaled(tex, dx, dy, size[0], size[1], alpha);
    }
  }
  return canvas;
}

const eyes = [295, 329]; // 右眼, 左眼 (参考位置)
const head = 697;
const headCrop = [-60, -379];

// 变体: 眼睛固定无crop + 头模板不同处理
const variants = [
  { id: 'T1_head_nocrop', desc: '头无crop+眼', cropMap: { [head]: [0, 0] } },
  { id: 'T2_head_yASIS', desc: '头crop y原样+眼', cropMap: { [head]: headCrop } },
  { id: 'T3_head_yFLIP', desc: '头crop y取反+眼', cropMap: { [head]: [headCrop[0], -headCrop[1]] } },
  { id: 'T4_head_halfY', desc: '头crop y减半+眼', cropMap: { [head]: [headCrop[0], headCrop[1]*0.5] } },
  { id: 'T5_head_org', desc: '头origin+crop+眼', cropMap: { [head]: [0, 0] } }, // 特殊: origin 叠加
];

for (const v of variants) {
  const ids = [...eyes, head];
  const canvas = renderParts(ids, v.cropMap);
  // 裁剪头部区域 (x 600-1150, y 950-1700)
  const buf = await sharp(Buffer.from(encodePng(canvas.w, canvas.h, canvas.data)))
    .extract({ left: 550, top: 900, width: 700, height: 900 })
    .resize(700, 900).png().toBuffer();
  fs.writeFileSync(OUT + v.id + '_' + v.desc + '.png', buf);
  console.log('生成', v.id, v.desc);
}
console.log('完成');
