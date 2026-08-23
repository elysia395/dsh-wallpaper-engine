// 生成: 头部+五官(无大衣躯干) 的渲染, 对比完整渲染
// 确认头部区域被大衣遮挡
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import { SceneRenderer, encodePng, getVal, Canvas } from '../lib/scene-renderer.js';
import fs from 'fs';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/';

// 只渲染头部区域部件: 头/眼/眉/鼻 + 头发(主发/刘海/垂发)
// 排除: 大衣(左/右)/躯干/臂
const INCLUDE = ['头', '右眼', '左眼', '眉毛', '鼻子', '主发', '刘海1', '刘海2', '刘海3', '刘海4', '刘海5', '刘海6', '刘海7', '左垂发组', '左垂发组2', '右垂发', '左飘发', '右飘发', '呆毛', '左耳', '右耳', '左马尾', '右马尾'];
const EXCLUDE = ['左大衣', '右大衣', '身体', '右臂', '左臂', '蝴蝶', '花', '栏杆'];

function renderSelective(include, exclude, cropMode) {
  const r = new SceneRenderer(PKG, { width: 3840, height: 2160, time: 0, log: () => {} });
  const canvas = new Canvas(3840, 2160);
  for (const o of r.renderOrder) {
    if (o._renderType !== 'image') continue;
    if (exclude.includes(o.name)) continue;
    const model = r.pkg.readJson(o.image);
    if (!model) continue;
    const tr = r.resolveTransform(o);
    const alpha = getVal(o, 'alpha', 1);
    if (model.puppet) {
      const crop = cropMode ? (model.cropoffset || '0 0').trim().split(/\s+/).map(Number) : [0, 0];
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
      const dw = size[0], dh = size[1];
      const dx = tr.origin[0] - dw / 2, dy = (r.H - tr.origin[1]) - dh / 2;
      canvas.blitScaled(tex, dx, dy, dw, dh, alpha);
    }
  }
  return canvas;
}

// A: 仅头部+五官 (无大衣躯干), 无 cropoffset
const cA = renderSelective(INCLUDE, EXCLUDE, false);
const bufA = await sharp(Buffer.from(encodePng(cA.w, cA.h, cA.data))).resize(1600, 900).png().toBuffer();
fs.writeFileSync(OUT + 'head_only_parts.png', bufA);
console.log('已生成 head_only_parts.png (仅头部+五官, 无大衣)');
