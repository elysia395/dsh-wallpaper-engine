// cropoffset 对普通 image quad 偏移实验: 耳朵对称性 + 头覆盖
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';
const T = 2.5;

// 版本 A: 无 cropoffset (当前)
// 版本 B: cropoffset 应用于普通 image (quad 偏移)
function make(applyCrop) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: T, weAssetsDir: WE, log: () => {} });
  const orig = r.renderImage.bind(r);
  if (applyCrop) {
    r.renderImage = (o, t) => {
      const model = r.readJsonAny(o.image);
      if (model && model.cropoffset && !model.puppet) {
        const [cx, cy] = model.cropoffset.trim().split(/\s+/).map(Number);
        // 临时偏移 origin (场景 y 向上)
        const cur = String(o.origin || '0 0 0').trim().split(/\s+/).map(Number);
        o._savedOrigin = o.origin;
        o.origin = `${cur[0] + cx} ${cur[1] + cy} ${cur[2] || 0}`;
      }
      return orig(o, t);
    };
  }
  r.render();
  return r;
}

const A = make(false);
const B = make(true);
function compBbox(r, oid) {
  const o = r.objects.find(x => x.id === oid);
  const saveVis = new Map();
  for (const oo of r.objects) { saveVis.set(oo.id, oo.visible); oo.visible = false; }
  o.visible = true;
  r.render();
  const d = r.canvas.data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, nz = 0;
  for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
    const i = (y * r.W + x) * 4;
    if (d[i + 3] > 10) { nz++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  for (const [oid2, v] of saveVis) { const obj = r.objects.find(x => x.id === oid2); if (obj) obj.visible = v; }
  return nz ? [minX, minY, maxX, maxY] : null;
}
for (const [label, rr] of [['A(无crop)', A], ['B(crop生效)', B]]) {
  const l = compBbox(rr, 685);
  const rr2 = compBbox(rr, 421);
  console.log(label + ' 左耳: ' + (l ? l.join(',') : '无') + ' 右耳: ' + (rr2 ? rr2.join(',') : '无'));
  // 头内容
  const head = compBbox(rr, 697);
  console.log(label + ' 头内容: ' + (head ? head.join(',') : '无'));
  // 头覆盖
  if (head) {
    let covered = 0, total = 0;
    const dA = rr.canvas.data;
    for (let y = head[1]; y <= head[3]; y++) for (let x = head[0]; x <= head[2]; x++) {
      const i = (y * rr.W + x) * 4;
      // 检查该像素是否被后续组件覆盖 — 简化: 用跳过版本对比
      total++;
    }
    console.log(label + ' 头区域像素 ' + total);
  }
}
