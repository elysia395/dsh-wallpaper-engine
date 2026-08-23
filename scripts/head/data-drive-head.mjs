// 数据驱动: 用立绘比例计算头模板正确位置
// 眼睛中心 y1340 (正确参考), 头模板高 579
// 目标: 眼睛在脸部 60-70% 高度处 → 头顶 = 1340 - 579*0.65
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import { SceneRenderer, encodePng, getVal, Canvas } from '../lib/scene-renderer.js';
import fs from 'fs';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/';
const r = new SceneRenderer(PKG, { width: 3840, height: 2160, time: 0, log: () => {} });

// 眼睛: 左眼 #329 (无crop, 位置对), 右眼 #295
// 头部正确部件: 眼睛/眉毛/鼻子 (它们无crop位置对)
const CORRECT = [329, 295, 373, 701]; // 左眼 右眼 眉毛 鼻子
const HEAD = 697;

// 计算: 头模板需要上移多少
const head = r.objects.find(x => x.id === HEAD);
const model = r.pkg.readJson(head.image);
const mesh = r._parseMdl(r.pkg.read(model.puppet));
const tr = r.resolveTransform(head);
const b = r._meshBounds(mesh.positions);
const W = Math.ceil(b.maxX - b.minX) + 1, H = Math.ceil(b.maxY - b.minY) + 1;
// 当前无crop: 头顶 = (H - origin.y) - maxY
const curTop = (r.H - tr.origin[1]) - b.maxY;
console.log('头模板: 网格' + W + 'x' + H, '当前头顶 y=' + curTop.toFixed(0), '当前头底 y=' + (curTop + H).toFixed(0));

// 眼睛中心 (左眼 y1277-1355 → 中心 1316, 右眼 y1339-1403 → 中心 1371; 平均 1343)
const eyeCenter = 1343;
// 立绘比例: 眼睛通常在头部高度的 62-68% 处 (头顶 0%, 下巴 100%)
// 头顶 = eyeCenter - H * ratio
for (const ratio of [0.55, 0.60, 0.62, 0.65, 0.68, 0.70]) {
  const top = eyeCenter - H * ratio;
  const bottom = top + H;
  console.log('ratio=' + ratio + ': 头顶=' + top.toFixed(0) + ' 头底=' + bottom.toFixed(0) + ' 需上移=' + (curTop - top).toFixed(0));
}
console.log('眼底 y≈1403, 头底应 ≈ 1430-1490 (眼下方有下巴)');
console.log('→ 头顶应 ≈ 850-910, 需上移 ≈ ' + (curTop - 880).toFixed(0) + 'px');

// 渲染: 头模板按计算上移 + 眼睛等正确部件
function render(shift) {
  const canvas = new Canvas(3840, 2160);
  const ids = [HEAD, ...CORRECT];
  for (const id of ids) {
    const o = r.objects.find(x => x.id === id);
    const m = r.pkg.readJson(o.image);
    const tr2 = r.resolveTransform(o);
    const alpha = getVal(o, 'alpha', 1);
    const mm = r._parseMdl(r.pkg.read(m.puppet));
    const tex = r.loadModelTexture(o.image);
    if (!tex) continue;
    // 头模板应用 shift, 其他不动
    const verts = id === HEAD ? mm.positions.map(p => [p[0], p[1] + shift, p[2]]) : mm.positions;
    const bb = r._meshBounds(verts);
    const WW = Math.ceil(bb.maxX - bb.minX) + 1, HH = Math.ceil(bb.maxY - bb.minY) + 1;
    const flipY = (y) => bb.maxY - y;
    const img = r._rasterizeMesh(mm, tex, verts, bb, WW, HH, flipY);
    const dx = tr2.origin[0] + bb.minX, dy = (r.H - tr2.origin[1]) - bb.maxY;
    canvas.blitScaled(img, dx, dy, WW, HH, alpha);
  }
  return canvas;
}

// 生成 shift 候选: 让头顶到 850-910
for (const shift of [160, 170, 180, 190, 200, 210, 220]) {
  const canvas = render(shift);
  const buf = await sharp(Buffer.from(encodePng(canvas.w, canvas.h, canvas.data)))
    .extract({ left: 550, top: 550, width: 700, height: 1200 })
    .resize(700, 1200).png().toBuffer();
  fs.writeFileSync(OUT + 'head_shift' + shift + '.png', buf);
  console.log('生成 shift=' + shift + ' (头顶=' + (curTop - shift).toFixed(0) + ')');
}
