// 头模板 y 偏移扫描: 从 -200 到 +300 步长 50, 眼睛固定参考
// 生成对比拼图供用户选择正确偏移
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import { SceneRenderer, encodePng, getVal, Canvas } from '../lib/scene-renderer.js';
import fs from 'fs';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/';
const r = new SceneRenderer(PKG, { width: 3840, height: 2160, time: 0, log: () => {} });

const EYES = [329, 295]; // 左眼, 右眼 (固定无crop = 参考正确位置)
const HEAD = 697;

// 渲染眼睛 + 头模板 (头顶点 y 偏移 dy)
function renderHeadWithDy(dy, label) {
  const canvas = new Canvas(3840, 2160);
  for (const id of [...EYES, HEAD]) {
    const o = r.objects.find(x => x.id === id);
    const model = r.pkg.readJson(o.image);
    const tr = r.resolveTransform(o);
    const alpha = getVal(o, 'alpha', 1);
    const mesh = r._parseMdl(r.pkg.read(model.puppet));
    const tex = r.loadModelTexture(o.image);
    if (!tex) continue;
    // 头模板应用 dy 偏移 (顶点 y + dy), 眼睛不偏移
    const verts = id === HEAD
      ? mesh.positions.map(p => [p[0], p[1] + dy, p[2]])
      : mesh.positions;
    const b = r._meshBounds(verts);
    const W = Math.ceil(b.maxX - b.minX) + 1, H = Math.ceil(b.maxY - b.minY) + 1;
    const flipY = (y) => b.maxY - y;
    const img = r._rasterizeMesh(mesh, tex, verts, b, W, H, flipY);
    const dx = tr.origin[0] + b.minX, dy2 = (r.H - tr.origin[1]) - b.maxY;
    canvas.blitScaled(img, dx, dy2, W, H, alpha);
  }
  return canvas;
}

// 扫描偏移量: 屏幕上移 = 顶点 y 增加. 头无crop [1072,1651] 盖眼(1277-1403)
// 需要头上移让眼在下部露出: dy = -100..+300
const dys = [-200, -100, 0, 100, 150, 200, 250, 300, 350, 400, 450];
const cells = [];
for (let i = 0; i < dys.length; i++) {
  const dy = dys[i];
  const canvas = renderHeadWithDy(dy, 'dy=' + dy);
  // 头部区域裁剪 (x 550-1250, y 600-1800)
  const buf = await sharp(Buffer.from(encodePng(canvas.w, canvas.h, canvas.data)))
    .extract({ left: 550, top: 600, width: 700, height: 1200 })
    .resize(350, 600).png().toBuffer();
  const f = OUT + 'scan_dy' + (dy >= 0 ? '+' : '') + dy + '.png';
  fs.writeFileSync(f, buf);
  cells.push({ input: buf, left: (i % 2) * 360, top: Math.floor(i / 2) * 620 });
  console.log('生成 dy=' + dy);
}

// 拼图 2 列
const cols = 2, rows = Math.ceil(dys.length / cols);
await sharp({ create: { width: cols * 360, height: rows * 620, channels: 3, background: { r: 30, g: 30, b: 35 } } })
  .composite(cells.map((c, i) => ({ input: c.input, left: c.left, top: c.top })))
  .png().toFile(OUT + '00_scan_HEAD_dy.png');
console.log('拼图 → 00_scan_HEAD_dy.png (' + cols * 360 + 'x' + rows * 620 + ')');
console.log('偏移顺序(从上到下, 每行2张):', dys.join(', '));
