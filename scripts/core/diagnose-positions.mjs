// 对象级诊断: 渲染矩形 vs 画布边界 (找出"画面外"组件)
import fs from 'node:fs';
import path from 'node:path';
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { getVal, parseVec3, parseVec2 } from '../../lib/we-renderer/math.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = process.argv[2] || '3641860575';

const r = new SceneRenderer(WS + '/' + id + '/scene.pkg', { width: 480, height: 270, time: 5, weAssetsDir: WE, log: () => {} });
const ortho = r.scene.general && r.scene.general.orthogonalprojection;
const ps = ortho && ortho.width ? [r.W / ortho.width, r.H / (ortho.height || 1080)] : null;
console.log('场景:', id, 'ortho:', JSON.stringify(ortho), '画布:', r.W + 'x' + r.H);

const rows = [];
for (const o of r.renderOrder) {
  const name = String(o.name || o.id);
  const tr = r.resolveTransform(o);
  let size = [0, 0];
  if (o.image) {
    // 尝试加载纹理尺寸 (简化: 用 scene size)
    size = parseVec2(getVal(o, 'size'), [0, 0]);
    const model = r.readJsonAny(o.image);
    if ((size[0] === 0 || size[1] === 0) && model && model.autosize) {
      // 用纹理尺寸
      const tex = r.loadModelTexture(o.image);
      if (tex) size = [tex.width, tex.height];
    }
  } else if (o.particle || o.sound || o.light) continue;
  else size = parseVec2(getVal(o, 'size'), [0, 0]);
  if (size[0] === 0 || size[1] === 0) continue;
  const sc = tr.scale;
  const dw = size[0] * sc[0] * (ps ? ps[0] : 1), dh = size[1] * sc[1] * (ps ? ps[1] : 1);
  if (dw > r.W * 3 || dh > r.H * 3) continue; // 跳过巨大组件
  let dx = tr.origin[0] * (ps ? ps[0] : 1) - dw / 2;
  let dy = r.H - tr.origin[1] * (ps ? ps[1] : 1) - dh / 2;
  const align = String(getVal(o, 'alignment', '')).toLowerCase();
  if (align.includes('top')) dy -= dh / 2;
  else if (align.includes('bottom')) dy += dh / 2;
  if (align.includes('left')) dx += dw / 2;
  else if (align.includes('right')) dx -= dw / 2;
  const inX = dx + dw > 0 && dx < r.W;
  const inY = dy + dh > 0 && dy < r.H;
  const status = inX && inY ? 'in' : 'OUT';
  if (status === 'OUT') rows.push(name + ': rect=' + [Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh)].join(',') + ' align=' + align);
}
console.log('画面外组件数:', rows.length);
rows.slice(0, 30).forEach((s) => console.log('  ' + s));
